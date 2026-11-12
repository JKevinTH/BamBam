const router = require('express').Router();
const pool = require('../db');
const { ErrorApp, ruta, numero, texto, redondear, validarEmpleado } = require('../util');

const DENOMINACIONES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

// La hora llega como HH:MM. El inicio cuenta desde el segundo 00 y el cierre hasta el segundo 59 de ese minuto.
const hora = (h, porDefecto, fin = false) => (/^\d{2}:\d{2}(:\d{2})?$/.test(h || '') ? (h.length === 5 ? h + (fin ? ':59' : ':00') : h) : porDefecto);

// Ventas por método y movimientos de dinero dentro de un rango
async function resumenRango(con, desde, hasta) {
  const [porMetodo] = await con.query(
    `SELECT TipoPago AS metodo, COUNT(*) AS ventas, COALESCE(SUM(Total),0) AS total
     FROM puntoventa WHERE FechaHora BETWEEN ? AND ? GROUP BY TipoPago`, [desde, hasta]);
  const ventas = { efectivo: 0, tarjeta: 0, transferencia: 0, cantidad: 0 };
  for (const m of porMetodo) { if (m.metodo in ventas) ventas[m.metodo] = m.total; ventas.cantidad += m.ventas; }
  ventas.total = redondear(ventas.efectivo + ventas.tarjeta + ventas.transferencia);

  const [movimientos] = await con.query(
    `SELECT m.id_movimiento, m.tipo, m.monto, m.concepto, m.fecha_hora, CONCAT(e.Nombre,' ',e.Apellido) AS empleado
     FROM movimientos_caja m LEFT JOIN empleados e ON e.ClaveE = m.ClaveE
     WHERE m.fecha_hora BETWEEN ? AND ? ORDER BY m.fecha_hora`, [desde, hasta]);
  const suma = (t) => redondear(movimientos.filter((m) => m.tipo === t).reduce((s, m) => s + m.monto, 0));
  return { ventas, movimientos, entradas: suma('entrada'), salidas: suma('salida') };
}

// GET /api/caja/resumen?fecha=2026-11-09&desde=17:00&hasta=23:00
router.get('/caja/resumen', ruta(async (req, res) => {
  const [[{ hoy }]] = await pool.query('SELECT CURDATE() AS hoy');
  const fecha = req.query.fecha || hoy;
  const desde = `${fecha} ${hora(req.query.desde, '00:00:00')}`;
  const hasta = `${fecha} ${hora(req.query.hasta, '23:59:59', true)}`;
  res.json(await resumenRango(pool, desde, hasta));
}));

// GET /api/caja/ultimo — último corte: sirve para prellenar el efectivo inicial
router.get('/caja/ultimo', ruta(async (req, res) => {
  const [[hoy]] = await pool.query('SELECT CURDATE() AS fecha, TIME_FORMAT(CURTIME(), "%H:%i") AS hora');
  const [[c]] = await pool.query('SELECT idcorte, fecha, horac FROM cortecaja ORDER BY fecha DESC, horac DESC, idcorte DESC LIMIT 1');
  let denominaciones = [];
  if (c) [denominaciones] = await pool.query('SELECT denominacion, cant_final AS cantidad FROM corte_denominaciones WHERE idcorte = ?', [c.idcorte]);
  res.json({ hoy: hoy.fecha, hora_actual: hoy.hora, ultimo: c || null, denominaciones });
}));

// POST /api/caja/movimientos — entrada o salida de dinero
router.post('/caja/movimientos', ruta(async (req, res) => {
  const b = req.body;
  if (!['entrada', 'salida'].includes(b.tipo)) throw new ErrorApp('Tipo de movimiento no válido');
  const clave = await validarEmpleado(pool, b.claveE);
  await pool.query('INSERT INTO movimientos_caja (tipo, monto, concepto, ClaveE) VALUES (?,?,?,?)',
    [b.tipo, numero(b.monto, 'El monto', { min: 0.01 }), texto(b.concepto, 'El concepto', { max: 100 }), clave]);
  res.status(201).json({ ok: true });
}));

// POST /api/caja/cortes — guarda el corte; TODO se calcula aquí, no se confía en el navegador
router.post('/caja/cortes', ruta(async (req, res) => {
  const b = req.body;
  const fecha = texto(b.fecha, 'La fecha', { max: 10 });
  const horai = hora(b.horai, null), horac = hora(b.horac, null, true);
  if (!horai || !horac) throw new ErrorApp('Indica la hora de inicio y la hora de cierre');
  if (horac <= horai) throw new ErrorApp('La hora de cierre debe ser posterior a la de inicio');

  const conteo = new Map();
  for (const d of Array.isArray(b.denominaciones) ? b.denominaciones : []) {
    const den = Number(d.denominacion);
    if (!DENOMINACIONES.includes(den)) throw new ErrorApp('Denominación no válida');
    conteo.set(den, {
      inicial: numero(d.inicial ?? 0, 'La cantidad inicial', { min: 0, entero: true }),
      final: numero(d.final ?? 0, 'La cantidad final', { min: 0, entero: true })
    });
  }
  let inicial = 0, contado = 0;
  for (const [den, c] of conteo) { inicial += den * c.inicial; contado += den * c.final; }

  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const clave = await validarEmpleado(con, b.claveE);
    const desde = `${fecha} ${horai}`, hasta = `${fecha} ${horac}`;
    const r = await resumenRango(con, desde, hasta);

    const esperado = redondear(inicial + r.ventas.efectivo + r.entradas - r.salidas);
    const diferencia = redondear(contado - esperado);
    const estado = Math.abs(diferencia) < 0.005 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante';

    const [ins] = await con.query(
      `INSERT INTO cortecaja (fecha, horai, horac, total, claveE, efectivo_inicial, efectivo_contado, ventas_efectivo, ventas_tarjeta,
                              ventas_transferencia, entradas, salidas, efectivo_esperado, diferencia, estado_caja)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [fecha, horai, horac, r.ventas.total, clave, inicial, contado, r.ventas.efectivo, r.ventas.tarjeta, r.ventas.transferencia,
       r.entradas, r.salidas, esperado, diferencia, estado]);
    const id = ins.insertId;
    if (conteo.size)
      await con.query('INSERT INTO corte_denominaciones (idcorte, denominacion, cant_inicial, cant_final) VALUES ?',
        [[...conteo].map(([den, c]) => [id, den, c.inicial, c.final])]);
    await con.query('UPDATE movimientos_caja SET idcorte = ? WHERE idcorte IS NULL AND fecha_hora BETWEEN ? AND ?', [id, desde, hasta]);
    await con.commit();
    res.status(201).json({ idcorte: id, esperado, contado, diferencia, estado });
  } catch (e) { await con.rollback(); throw e; } finally { con.release(); }
}));

const COLUMNAS_CORTE = `c.idcorte, c.fecha, c.horai, c.horac, c.total AS ventas_total, c.efectivo_inicial, c.efectivo_contado,
  c.ventas_efectivo, c.ventas_tarjeta, c.ventas_transferencia, c.entradas, c.salidas, c.efectivo_esperado, c.diferencia,
  c.estado_caja AS estado, CONCAT(e.Nombre, ' ', e.Apellido) AS empleado`;

// GET /api/caja/cortes — historial
router.get('/caja/cortes', ruta(async (req, res) => {
  const [filas] = await pool.query(
    `SELECT ${COLUMNAS_CORTE} FROM cortecaja c LEFT JOIN empleados e ON e.ClaveE = c.claveE
     ORDER BY c.fecha DESC, c.horac DESC, c.idcorte DESC LIMIT 200`);
  res.json(filas);
}));

// GET /api/caja/cortes/:id — detalle para ver o exportar a PDF
router.get('/caja/cortes/:id', ruta(async (req, res) => {
  const [[c]] = await pool.query(`SELECT ${COLUMNAS_CORTE} FROM cortecaja c LEFT JOIN empleados e ON e.ClaveE = c.claveE WHERE c.idcorte = ?`, [req.params.id]);
  if (!c) throw new ErrorApp('Corte no encontrado', 404);
  const [denominaciones] = await pool.query('SELECT denominacion, cant_inicial, cant_final FROM corte_denominaciones WHERE idcorte = ? ORDER BY denominacion', [c.idcorte]);
  const [movimientos] = await pool.query('SELECT tipo, monto, concepto, fecha_hora FROM movimientos_caja WHERE idcorte = ? ORDER BY fecha_hora', [c.idcorte]);
  res.json({ ...c, denominaciones, movimientos });
}));

module.exports = router;
