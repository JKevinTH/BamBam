const jwt = require('jsonwebtoken');

// Error con un mensaje que SÍ se le muestra al usuario
class ErrorApp extends Error {
  constructor(mensaje, estado = 400) { super(mensaje); this.estado = estado; this.publico = true; }
}

// Envuelve una ruta async para atrapar errores
const ruta = (fn) => (req, res) =>
  fn(req, res).catch((e) => {
    if (!e.publico) console.error(e);
    res.status(e.estado || 500).json({ error: e.publico ? e.message : 'Error del servidor' });
  });

const SECRETO = process.env.JWT_SECRET || require('crypto').randomBytes(32).toString('hex');

function requerirSesion(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  try { req.usuario = jwt.verify(token, SECRETO); next(); }
  catch { res.status(401).json({ error: 'Sesión no válida' }); }
}

const firmar = (datos) => jwt.sign(datos, SECRETO, { expiresIn: '12h' });

// Valida un número. opciones: { min, max, entero }
function numero(valor, nombre, { min = 0, max = Infinity, entero = false } = {}) {
  const n = Number(valor);
  if (valor === '' || valor === null || valor === undefined || !Number.isFinite(n))
    throw new ErrorApp(`${nombre} no es un número válido`);
  if (n < min) throw new ErrorApp(`${nombre} debe ser mayor o igual a ${min}`);
  if (n > max) throw new ErrorApp(`${nombre} debe ser menor o igual a ${max}`);
  if (entero && !Number.isInteger(n)) throw new ErrorApp(`${nombre} debe ser un número entero`);
  return n;
}

function texto(valor, nombre, { max = 100, requerido = true } = {}) {
  const t = String(valor ?? '').trim();
  if (requerido && !t) throw new ErrorApp(`${nombre} es obligatorio`);
  if (t.length > max) throw new ErrorApp(`${nombre} es demasiado largo`);
  return t || null;
}

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// Estado de un ingrediente según su existencia y su mínimo
const estadoStock = (cantidad, minimo) => (cantidad <= 0 ? 'agotado' : cantidad <= minimo ? 'bajo' : 'stock');

// Comprueba que el empleado exista
async function validarEmpleado(con, clave) {
  const [[e]] = await con.query('SELECT ClaveE FROM empleados WHERE ClaveE = ?', [clave]);
  if (!e) throw new ErrorApp('Selecciona el empleado que está en caja');
  return e.ClaveE;
}

module.exports = { ErrorApp, ruta, requerirSesion, firmar, numero, texto, redondear, estadoStock, validarEmpleado };
