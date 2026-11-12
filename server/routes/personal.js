const router = require('express').Router();
const pool = require('../db');
const { ErrorApp, ruta, validarEmpleado } = require('../util');
const { TURNOS, TURNO_POR_DEFECTO, TOLERANCIA_MIN } = require('../config');

const aMinutos = (hms) => { const [h, m] = hms.split(':').map(Number); return h * 60 + m; };

// GET /api/personal/hoy — empleados con su asistencia de hoy
router.get('/personal/hoy', ruta(async (req, res) => {
  const [filas] = await pool.query(
    `SELECT e.ClaveE AS clave, e.Nombre AS nombre, e.Apellido AS apellido, e.Rol AS rol, e.Horario AS horario,
            a.entrada, a.salida
     FROM empleados e
     LEFT JOIN asistencia a ON a.idasistencia = (
        SELECT MAX(idasistencia) FROM asistencia WHERE ClaveE = e.ClaveE AND fecha = CURDATE())
     ORDER BY e.Nombre`);
  res.json(filas.map((f) => {
    const inicio = TURNOS[String(f.horario).toLowerCase()] || TURNO_POR_DEFECTO;
    const retardo = !!f.entrada && aMinutos(f.entrada) > aMinutos(inicio) + TOLERANCIA_MIN;
    return { ...f, inicio_turno: inicio, retardo };
  }));
}));

router.post('/personal/entrada', ruta(async (req, res) => {
  const clave = await validarEmpleado(pool, req.body.clave);
  const [[ya]] = await pool.query('SELECT idasistencia FROM asistencia WHERE ClaveE = ? AND fecha = CURDATE()', [clave]);
  if (ya) throw new ErrorApp('Este empleado ya registró su entrada hoy');
  await pool.query('INSERT INTO asistencia (ClaveE, fecha, entrada) VALUES (?, CURDATE(), CURTIME())', [clave]);
  res.status(201).json({ ok: true });
}));

router.post('/personal/salida', ruta(async (req, res) => {
  const clave = await validarEmpleado(pool, req.body.clave);
  const [r] = await pool.query(
    'UPDATE asistencia SET salida = CURTIME() WHERE ClaveE = ? AND fecha = CURDATE() AND salida IS NULL', [clave]);
  if (!r.affectedRows) throw new ErrorApp('Primero debes registrar la entrada');
  res.json({ ok: true });
}));

module.exports = router;
