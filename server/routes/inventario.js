const router = require('express').Router();
const pool = require('../db');
const { ErrorApp, ruta, numero, texto, redondear, estadoStock, validarEmpleado } = require('../util');
const { DIAS_AVISO_CADUCIDAD } = require('../config');

// ---------- Existencias ----------
// GET /api/inventario?buscar=queso&categoria=base
router.get('/inventario', ruta(async (req, res) => {
  const filtros = [], valores = [];
  if (req.query.buscar)    { filtros.push('i.nombre LIKE ?');  valores.push(`%${req.query.buscar}%`); }
  if (req.query.categoria) { filtros.push('i.categoria = ?');  valores.push(req.query.categoria); }
  const [filas] = await pool.query(
    `SELECT i.codigo, i.nombre, i.categoria, i.cantidad, i.unidad, i.stock_minimo, i.caducidad, i.costo_unitario,
            i.id_proveedor, pr.nombre AS proveedor, i.fechaAct AS actualizado,
            CASE WHEN i.cantidad <= 0 THEN 'agotado' WHEN i.cantidad <= i.stock_minimo THEN 'bajo' ELSE 'stock' END AS estado,
            DATEDIFF(i.caducidad, CURDATE()) AS dias_caducidad
     FROM inventario i LEFT JOIN proveedores pr ON pr.id_proveedor = i.id_proveedor
     ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
     ORDER BY i.categoria, i.nombre`, valores);
  res.json({ items: filas, dias_aviso_caducidad: DIAS_AVISO_CADUCIDAD });
}));

router.get('/inventario/categorias', ruta(async (req, res) => {
  const [filas] = await pool.query('SELECT DISTINCT categoria FROM inventario ORDER BY categoria');
  res.json(filas.map((f) => f.categoria));
}));

function datosIngrediente(b) {
  return {
    nombre: texto(b.nombre, 'El nombre', { max: 50 }).toLowerCase(),
    categoria: texto(b.categoria, 'La categoría', { max: 30 }).toLowerCase(),
    unidad: texto(b.unidad, 'La unidad', { max: 10 }),
    stock_minimo: numero(b.stock_minimo ?? 0, 'El stock mínimo', { min: 0 }),
    costo_unitario: numero(b.costo_unitario ?? 0, 'El costo', { min: 0 }),
    id_proveedor: b.id_proveedor ? numero(b.id_proveedor, 'Proveedor', { entero: true }) : null,
    caducidad: b.caducidad || null
  };
}

// POST /api/inventario — nuevo ingrediente
router.post('/inventario', ruta(async (req, res) => {
  const d = datosIngrediente(req.body);
  const inicial = numero(req.body.cantidad ?? 0, 'La cantidad inicial', { min: 0 });
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const clave = req.body.claveE ? await validarEmpleado(con, req.body.claveE) : null;
    const [[{ siguiente }]] = await con.query('SELECT COALESCE(MAX(codigo), 0) + 1 AS siguiente FROM inventario FOR UPDATE');
    await con.query(
      `INSERT INTO inventario (codigo, nombre, categoria, cantidad, unidad, estado, fechaAct, stock_minimo, caducidad, costo_unitario, id_proveedor)
       VALUES (?,?,?,?,?,?,CURDATE(),?,?,?,?)`,
      [siguiente, d.nombre, d.categoria, inicial, d.unidad, estadoStock(inicial, d.stock_minimo), d.stock_minimo, d.caducidad, d.costo_unitario, d.id_proveedor]);
    if (inicial > 0)
      await con.query(
        `INSERT INTO movimientos_inventario (codigo, tipo, cantidad, existencia_anterior, existencia_nueva, costo_unitario, id_proveedor, caducidad, motivo, ClaveE)
         VALUES (?, 'entrada', ?, 0, ?, ?, ?, ?, 'Existencia inicial', ?)`,
        [siguiente, inicial, inicial, d.costo_unitario, d.id_proveedor, d.caducidad, clave]);
    await con.commit();
    res.status(201).json({ codigo: siguiente });
  } catch (e) {
    await con.rollback();
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un ingrediente con ese nombre');
    throw e;
  } finally { con.release(); }
}));

// PUT /api/inventario/:codigo — editar datos (no cambia la existencia)
router.put('/inventario/:codigo', ruta(async (req, res) => {
  const d = datosIngrediente(req.body);
  try {
    await pool.query(
      `UPDATE inventario SET nombre=?, categoria=?, unidad=?, stock_minimo=?, costo_unitario=?, id_proveedor=?, caducidad=?,
              estado = CASE WHEN cantidad <= 0 THEN 'agotado' WHEN cantidad <= ? THEN 'bajo' ELSE 'stock' END
       WHERE codigo=?`,
      [d.nombre, d.categoria, d.unidad, d.stock_minimo, d.costo_unitario, d.id_proveedor, d.caducidad, d.stock_minimo, req.params.codigo]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un ingrediente con ese nombre');
    throw e;
  }
}));

// ---------- Movimientos: entrada, salida y ajuste ----------
// POST /api/inventario/:codigo/movimiento
// { tipo: 'entrada'|'salida'|'ajuste', cantidad, costo_unitario?, id_proveedor?, caducidad?, motivo?, claveE }
// En "ajuste", cantidad es la existencia REAL contada.
router.post('/inventario/:codigo/movimiento', ruta(async (req, res) => {
  const b = req.body;
  if (!['entrada', 'salida', 'ajuste'].includes(b.tipo)) throw new ErrorApp('Tipo de movimiento no válido');
  const cantidad = numero(b.cantidad, b.tipo === 'ajuste' ? 'La existencia contada' : 'La cantidad', { min: b.tipo === 'ajuste' ? 0 : 0.0001 });

  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const clave = await validarEmpleado(con, b.claveE);
    const [[i]] = await con.query('SELECT * FROM inventario WHERE codigo = ? FOR UPDATE', [req.params.codigo]);
    if (!i) throw new ErrorApp('Ingrediente no encontrado', 404);

    let nueva;
    if (b.tipo === 'entrada') nueva = i.cantidad + cantidad;
    else if (b.tipo === 'salida') {
      if (cantidad > i.cantidad) throw new ErrorApp(`Solo hay ${i.cantidad} ${i.unidad} de ${i.nombre}`);
      nueva = i.cantidad - cantidad;
    } else nueva = cantidad;
    nueva = Math.round(nueva * 10000) / 10000;
    const delta = Math.round((nueva - i.cantidad) * 10000) / 10000;

    let costo = null, proveedor = null, caducidad = null;
    let sql = 'UPDATE inventario SET cantidad = ?, estado = ?, fechaAct = CURDATE()';
    const par = [nueva, estadoStock(nueva, i.stock_minimo)];
    if (b.tipo === 'entrada') {
      costo = b.costo_unitario !== '' && b.costo_unitario != null ? numero(b.costo_unitario, 'El costo', { min: 0 }) : null;
      proveedor = b.id_proveedor ? numero(b.id_proveedor, 'Proveedor', { entero: true }) : null;
      caducidad = b.caducidad || null;
      if (costo !== null)   { sql += ', costo_unitario = ?'; par.push(costo); }
      if (proveedor)        { sql += ', id_proveedor = ?';   par.push(proveedor); }
      if (caducidad)        { sql += ', caducidad = ?';      par.push(caducidad); }
    }
    await con.query(sql + ' WHERE codigo = ?', [...par, i.codigo]);
    await con.query(
      `INSERT INTO movimientos_inventario (codigo, tipo, cantidad, existencia_anterior, existencia_nueva, costo_unitario, id_proveedor, caducidad, motivo, ClaveE)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [i.codigo, b.tipo, delta, i.cantidad, nueva, costo, proveedor, caducidad, texto(b.motivo, 'El motivo', { max: 120, requerido: false }), clave]);
    await con.commit();
    res.json({ cantidad: nueva });
  } catch (e) { await con.rollback(); throw e; } finally { con.release(); }
}));

// GET /api/movimientos?tipo=entrada&buscar=queso&limite=200
router.get('/movimientos', ruta(async (req, res) => {
  const filtros = [], valores = [];
  if (req.query.tipo)   { filtros.push('m.tipo = ?');       valores.push(req.query.tipo); }
  if (req.query.buscar) { filtros.push('i.nombre LIKE ?');  valores.push(`%${req.query.buscar}%`); }
  const [filas] = await pool.query(
    `SELECT m.id_movimiento, m.fecha_hora, i.nombre AS ingrediente, i.unidad, m.tipo, m.cantidad,
            m.existencia_anterior, m.existencia_nueva, m.costo_unitario, pr.nombre AS proveedor, m.caducidad,
            m.motivo, CONCAT(e.Nombre, ' ', e.Apellido) AS empleado
     FROM movimientos_inventario m
     JOIN inventario i ON i.codigo = m.codigo
     LEFT JOIN proveedores pr ON pr.id_proveedor = m.id_proveedor
     LEFT JOIN empleados e ON e.ClaveE = m.ClaveE
     ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
     ORDER BY m.fecha_hora DESC, m.id_movimiento DESC LIMIT ?`, [...valores, Math.min(Number(req.query.limite) || 200, 1000)]);
  res.json(filas);
}));

// ---------- Proveedores ----------
router.get('/proveedores', ruta(async (req, res) => {
  const [filas] = await pool.query('SELECT id_proveedor, nombre, telefono, correo, activo FROM proveedores ORDER BY nombre');
  res.json(filas);
}));

function datosProveedor(b) {
  return [texto(b.nombre, 'El nombre', { max: 80 }), texto(b.telefono, 'El teléfono', { max: 15, requerido: false }),
          texto(b.correo, 'El correo', { max: 80, requerido: false })];
}

router.post('/proveedores', ruta(async (req, res) => {
  try {
    const [r] = await pool.query('INSERT INTO proveedores (nombre, telefono, correo) VALUES (?,?,?)', datosProveedor(req.body));
    res.status(201).json({ id_proveedor: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un proveedor con ese nombre');
    throw e;
  }
}));

router.put('/proveedores/:id', ruta(async (req, res) => {
  try {
    await pool.query('UPDATE proveedores SET nombre=?, telefono=?, correo=? WHERE id_proveedor=?', [...datosProveedor(req.body), req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un proveedor con ese nombre');
    throw e;
  }
}));

module.exports = router;
