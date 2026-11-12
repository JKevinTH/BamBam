const router = require('express').Router();
const pool = require('../db');
const { ErrorApp, ruta, numero, texto } = require('../util');

const CATEGORIAS = ['pizza', 'bebida', 'complemento'];

// GET /api/productos            -> catálogo activo (para vender)
// GET /api/productos?todos=1    -> incluye los desactivados (para administrar)
router.get('/productos', ruta(async (req, res) => {
  const where = req.query.todos ? '' : 'WHERE activo = 1';
  const [filas] = await pool.query(
    `SELECT id_producto, nombre, categoria, precio, imagen, activo FROM productos ${where}
     ORDER BY FIELD(categoria,'pizza','bebida','complemento'), nombre`);
  res.json(filas);
}));

function datosProducto(b) {
  const categoria = String(b.categoria || '');
  if (!CATEGORIAS.includes(categoria)) throw new ErrorApp('Categoría no válida');
  return [texto(b.nombre, 'El nombre', { max: 60 }), categoria, numero(b.precio, 'El precio', { min: 0 }),
          texto(b.imagen, 'La imagen', { max: 200, requerido: false })];
}

router.post('/productos', ruta(async (req, res) => {
  try {
    const [r] = await pool.query('INSERT INTO productos (nombre, categoria, precio, imagen) VALUES (?,?,?,?)', datosProducto(req.body));
    res.status(201).json({ id_producto: r.insertId });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un producto con ese nombre');
    throw e;
  }
}));

router.put('/productos/:id', ruta(async (req, res) => {
  const activo = req.body.activo === false || req.body.activo === 0 ? 0 : 1;
  try {
    await pool.query('UPDATE productos SET nombre=?, categoria=?, precio=?, imagen=?, activo=? WHERE id_producto=?',
      [...datosProducto(req.body), activo, req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    if (e.code === 'ER_DUP_ENTRY') throw new ErrorApp('Ya existe un producto con ese nombre');
    throw e;
  }
}));

// ---- Recetas ----
router.get('/productos/:id/receta', ruta(async (req, res) => {
  const [filas] = await pool.query(
    `SELECT r.codigo, i.nombre, i.unidad, r.cantidad FROM recetas r
     JOIN inventario i ON i.codigo = r.codigo WHERE r.id_producto = ? ORDER BY i.nombre`, [req.params.id]);
  res.json(filas);
}));

// PUT reemplaza la receta completa: { ingredientes: [{ codigo, cantidad }] }
router.put('/productos/:id/receta', ruta(async (req, res) => {
  const lista = Array.isArray(req.body.ingredientes) ? req.body.ingredientes : [];
  const vistos = new Set();
  const filas = lista.map((r) => {
    const codigo = numero(r.codigo, 'Ingrediente', { entero: true });
    if (vistos.has(codigo)) throw new ErrorApp('Un ingrediente está repetido en la receta');
    vistos.add(codigo);
    return [Number(req.params.id), codigo, numero(r.cantidad, 'La cantidad', { min: 0.0001 })];
  });
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    await con.query('DELETE FROM recetas WHERE id_producto = ?', [req.params.id]);
    if (filas.length) await con.query('INSERT INTO recetas (id_producto, codigo, cantidad) VALUES ?', [filas]);
    await con.commit();
    res.json({ ok: true });
  } catch (e) { await con.rollback(); throw e; } finally { con.release(); }
}));

// ---- Promociones (descuentos automáticos) ----
router.get('/promociones', ruta(async (req, res) => {
  const [filas] = await pool.query('SELECT id_promocion, nombre, tipo, valor, compra_minima FROM promociones WHERE activo = 1');
  res.json(filas);
}));

module.exports = router;
