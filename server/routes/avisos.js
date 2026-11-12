const router = require('express').Router();
const pool = require('../db');
const { ruta } = require('../util');
const { DIAS_AVISO_CADUCIDAD } = require('../config');

// GET /api/avisos — notificaciones del inicio, calculadas en vivo con los datos reales
router.get('/avisos', ruta(async (req, res) => {
  const avisos = [];
  const cant = (n) => Number(n.toFixed(2));

  const [bajos] = await pool.query(
    `SELECT nombre, cantidad, unidad, stock_minimo, fechaAct FROM inventario
     WHERE stock_minimo > 0 AND cantidad <= stock_minimo ORDER BY (cantidad / stock_minimo) LIMIT 4`);
  for (const i of bajos)
    avisos.push({ tipo: 'urgente', etiqueta: `Actualizado ${i.fechaAct}`,
      titulo: `${i.cantidad <= 0 ? 'Agotado' : 'Stock bajo'}: ${i.nombre}`,
      texto: `Quedan ${cant(i.cantidad)} ${i.unidad} y el mínimo es ${cant(i.stock_minimo)}.`,
      enlace: 'inventario.html', boton: 'Ver inventario →' });

  const [porCaducar] = await pool.query(
    `SELECT nombre, caducidad, DATEDIFF(caducidad, CURDATE()) AS dias FROM inventario
     WHERE caducidad IS NOT NULL AND cantidad > 0 AND caducidad <= DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY caducidad LIMIT 3`, [DIAS_AVISO_CADUCIDAD]);
  for (const i of porCaducar)
    avisos.push({ tipo: 'urgente', etiqueta: `Caduca ${i.caducidad}`,
      titulo: i.dias < 0 ? `Caducado: ${i.nombre}` : `Por caducar: ${i.nombre}`,
      texto: i.dias < 0 ? 'Retíralo del inventario.' : `Le quedan ${i.dias} día(s).`,
      enlace: 'inventario.html', boton: 'Ver inventario →' });

  const [[{ sinEntrada }]] = await pool.query(
    `SELECT COUNT(*) AS sinEntrada FROM empleados e
     WHERE NOT EXISTS (SELECT 1 FROM asistencia a WHERE a.ClaveE = e.ClaveE AND a.fecha = CURDATE())`);
  if (sinEntrada > 0)
    avisos.push({ tipo: 'urgente', etiqueta: 'Hoy', titulo: 'Entradas sin registrar',
      texto: `${sinEntrada} empleado(s) todavía no registran su entrada.`, enlace: 'personal.html', boton: 'Ver personal →' });

  const [[{ ventasHoy }]] = await pool.query('SELECT COUNT(*) AS ventasHoy FROM puntoventa WHERE DATE(FechaHora) = CURDATE()');
  const [[{ cortesHoy }]] = await pool.query('SELECT COUNT(*) AS cortesHoy FROM cortecaja WHERE fecha = CURDATE()');
  if (ventasHoy > 0 && cortesHoy === 0)
    avisos.push({ tipo: 'ok', etiqueta: 'Hoy', titulo: 'Corte de caja pendiente',
      texto: `Hay ${ventasHoy} venta(s) hoy. Recuerda hacer el corte antes de cerrar el turno.`, enlace: 'corte_de_caja.html', boton: 'Ir al corte de caja →' });

  if (!avisos.length)
    avisos.push({ tipo: 'ok', etiqueta: 'Hoy', titulo: 'Todo en orden', texto: 'No hay avisos pendientes en este momento.', enlace: 'ventas.html', boton: 'Nueva venta →' });

  res.json(avisos);
}));

module.exports = router;
