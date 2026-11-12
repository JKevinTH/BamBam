const router = require('express').Router();
const bcrypt = require('bcryptjs');
const pool = require('../db');
const { ErrorApp, ruta, firmar, requerirSesion } = require('../util');

// POST /api/login
router.post('/login', ruta(async (req, res) => {
  const usuario = String(req.body.usuario || '').trim();
  const clave = String(req.body.contrasena || '');
  if (!usuario || !clave) throw new ErrorApp('Escribe tu usuario y tu contraseña');

  const [[u]] = await pool.query('SELECT IDusuario, Nombre, Contrasena FROM usuario WHERE Nombre = ?', [usuario]);
  let ok = false;
  if (u) {
    if (u.Contrasena.startsWith('$2')) ok = await bcrypt.compare(clave, u.Contrasena);
    else if (u.Contrasena === clave) {
      ok = true; // contraseña guardada en texto plano: se convierte a hash al primer ingreso
      await pool.query('UPDATE usuario SET Contrasena = ? WHERE IDusuario = ?', [await bcrypt.hash(clave, 10), u.IDusuario]);
    }
  }
  if (!ok) throw new ErrorApp('Usuario o contraseña incorrectos', 401);

  res.json({ token: firmar({ id: u.IDusuario, nombre: u.Nombre }), usuario: { id: u.IDusuario, nombre: u.Nombre } });
}));

// GET /api/empleados  (empleados del usuario que inició sesión)
router.get('/empleados', requerirSesion, ruta(async (req, res) => {
  const [filas] = await pool.query(
    `SELECT ClaveE AS clave, Nombre AS nombre, Apellido AS apellido, Rol AS rol, Horario AS horario
     FROM empleados WHERE IDusuario = ? ORDER BY Nombre`, [req.usuario.id]);
  res.json(filas);
}));

module.exports = router;
