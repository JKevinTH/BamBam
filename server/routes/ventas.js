const router = require('express').Router();
const pool = require('../db');
const { ErrorApp, ruta, numero, redondear, estadoStock, validarEmpleado } = require('../util');

const METODOS = ['efectivo', 'tarjeta', 'transferencia'];

// Ticket completo de una venta
async function obtenerTicket(con, numeroV) {
  const [[v]] = await con.query(
    `SELECT p.NumeroV AS folio, p.FechaHora AS fecha_hora, p.Subtotal AS subtotal, p.Descuento AS descuento,
            p.Total AS total, p.TipoPago AS tipo_pago, p.Recibido AS recibido, p.Cambio AS cambio,
            p.ClaveE AS clave_empleado, CONCAT(e.Nombre, ' ', e.Apellido) AS empleado
     FROM puntoventa p LEFT JOIN empleados e ON e.ClaveE = p.ClaveE WHERE p.NumeroV = ?`, [numeroV]);
  if (!v) throw new ErrorApp('Venta no encontrada', 404);
  const [lineas] = await con.query(
    'SELECT Producto AS producto, Cantidad AS cantidad, PU AS precio, Total AS importe FROM ventas WHERE NumeroV = ? ORDER BY IDventa', [numeroV]);
  return { ...v, lineas };
}

// POST /api/ventas  — registra la venta, calcula todo en el servidor y descuenta ingredientes
router.post('/ventas', ruta(async (req, res) => {
  const b = req.body;
  const items = Array.isArray(b.items) ? b.items : [];
  if (!items.length) throw new ErrorApp('El pedido está vacío');
  const metodo = String(b.tipo_pago || '');
  if (!METODOS.includes(metodo)) throw new ErrorApp('Selecciona un método de pago');

  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const clave = await validarEmpleado(con, b.claveE);

    // 1) Precios SIEMPRE desde el catálogo
    const pedido = new Map();
    for (const it of items) {
      const id = numero(it.id_producto, 'Producto', { entero: true });
      pedido.set(id, (pedido.get(id) || 0) + numero(it.cantidad, 'La cantidad', { min: 1, max: 99, entero: true }));
    }
    const [productos] = await con.query('SELECT id_producto, nombre, precio FROM productos WHERE activo = 1 AND id_producto IN (?)', [[...pedido.keys()]]);
    if (productos.length !== pedido.size) throw new ErrorApp('Hay un producto que ya no está disponible');

    const lineas = productos.map((p) => ({ ...p, cantidad: pedido.get(p.id_producto), importe: redondear(p.precio * pedido.get(p.id_producto)) }));
    const subtotal = redondear(lineas.reduce((s, l) => s + l.importe, 0));

    // 2) Descuentos: promoción automática + descuento manual
    let promo = 0;
    if (b.aplicar_promo) {
      const [promos] = await con.query('SELECT tipo, valor FROM promociones WHERE activo = 1 AND compra_minima <= ?', [subtotal]);
      promo = Math.max(0, ...promos.map((p) => (p.tipo === 'porcentaje' ? subtotal * p.valor / 100 : p.valor)));
    }
    let manual = 0;
    if (b.descuento_manual_valor) {
      const v = numero(b.descuento_manual_valor, 'El descuento', { min: 0 });
      if (b.descuento_manual_tipo === 'porcentaje') manual = subtotal * Math.min(v, 100) / 100;
      else manual = v;
    }
    const descuento = redondear(Math.min(subtotal, promo + manual));
    const total = redondear(subtotal - descuento);

    // 3) Pago y cambio
    let recibido = total, cambio = 0;
    if (metodo === 'efectivo') {
      recibido = numero(b.recibido, 'El dinero recibido', { min: 0 });
      if (recibido < total) throw new ErrorApp('El dinero recibido no alcanza para cubrir el total');
      cambio = redondear(recibido - total);
    }

    // 4) Guardar encabezado y renglones
    const [enc] = await con.query(
      `INSERT INTO puntoventa (Fecha, FechaHora, Descuento, Subtotal, Total, TipoPago, ClaveE, Recibido, Cambio)
       VALUES (CURDATE(), NOW(), ?, ?, ?, ?, ?, ?, ?)`, [descuento, subtotal, total, metodo, clave, recibido, cambio]);
    const numeroV = enc.insertId;
    await con.query('INSERT INTO ventas (NumeroV, Producto, Cantidad, PU, Total, descuento, pago, id_producto) VALUES ?',
      [lineas.map((l) => [numeroV, l.nombre, l.cantidad, l.precio, l.importe, 0, metodo, l.id_producto])]);

    // 5) Descontar ingredientes según la receta de cada producto
    const advertencias = [];
    for (const l of lineas) {
      const [receta] = await con.query(
        `SELECT r.codigo, r.cantidad, i.nombre, i.cantidad AS existencia, i.stock_minimo
         FROM recetas r JOIN inventario i ON i.codigo = r.codigo WHERE r.id_producto = ? FOR UPDATE`, [l.id_producto]);
      for (const r of receta) {
        const [[actual]] = await con.query('SELECT cantidad FROM inventario WHERE codigo = ?', [r.codigo]);
        const necesario = r.cantidad * l.cantidad;
        const nueva = Math.max(0, Math.round((actual.cantidad - necesario) * 10000) / 10000);
        if (actual.cantidad < necesario) advertencias.push(`Falta ${r.nombre} (se agotó)`);
        await con.query('UPDATE inventario SET cantidad = ?, estado = ?, fechaAct = CURDATE() WHERE codigo = ?',
          [nueva, estadoStock(nueva, r.stock_minimo), r.codigo]);
        await con.query(
          `INSERT INTO movimientos_inventario (codigo, tipo, cantidad, existencia_anterior, existencia_nueva, motivo, NumeroV, ClaveE)
           VALUES (?, 'venta', ?, ?, ?, ?, ?, ?)`,
          [r.codigo, -(actual.cantidad - nueva), actual.cantidad, nueva, `Venta #${numeroV}: ${l.nombre} x${l.cantidad}`, numeroV, clave]);
      }
    }

    const ticket = await obtenerTicket(con, numeroV);
    await con.commit();
    res.status(201).json({ ticket, advertencias: [...new Set(advertencias)], promo: redondear(promo), manual: redondear(manual) });
  } catch (e) { await con.rollback(); throw e; } finally { con.release(); }
}));

// GET /api/ventas?desde=YYYY-MM-DD&hasta=YYYY-MM-DD  — historial
router.get('/ventas', ruta(async (req, res) => {
  const desde = req.query.desde || null, hasta = req.query.hasta || null;
  const filtro = 'DATE(p.FechaHora) BETWEEN COALESCE(?, CURDATE()) AND COALESCE(?, CURDATE())';
  const [ventas] = await pool.query(
    `SELECT p.NumeroV AS folio, p.FechaHora AS fecha_hora, p.Subtotal AS subtotal, p.Descuento AS descuento,
            p.Total AS total, p.TipoPago AS tipo_pago, CONCAT(e.Nombre, ' ', e.Apellido) AS empleado
     FROM puntoventa p LEFT JOIN empleados e ON e.ClaveE = p.ClaveE
     WHERE ${filtro} ORDER BY p.FechaHora DESC, p.NumeroV DESC LIMIT 500`, [desde, hasta]);
  const [[resumen]] = await pool.query(
    `SELECT COUNT(*) AS cantidad, COALESCE(SUM(p.Total),0) AS total FROM puntoventa p WHERE ${filtro}`, [desde, hasta]);
  res.json({ ventas, resumen });
}));

// GET /api/ventas/:folio — ticket
router.get('/ventas/:folio', ruta(async (req, res) => {
  res.json(await obtenerTicket(pool, req.params.folio));
}));

module.exports = router;
