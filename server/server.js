const path = require('path');
const express = require('express');
const cors = require('cors');
require('./db');                                   // carga .env
const { requerirSesion } = require('./util');

const app = express();
app.use(cors());
app.use(express.json());

// ---- API ----
app.use('/api', require('./routes/auth'));         // /login es público
app.use('/api', requerirSesion);                   // todo lo demás exige sesión
app.use('/api', require('./routes/productos'));
app.use('/api', require('./routes/ventas'));
app.use('/api', require('./routes/inventario'));
app.use('/api', require('./routes/caja'));
app.use('/api', require('./routes/personal'));
app.use('/api', require('./routes/avisos'));
app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta no encontrada' }));

// ---- Páginas del sistema (la carpeta del proyecto) ----
const RAIZ = path.join(__dirname, '..');
app.use(['/server', '/database', '/.git', '/.vscode'], (req, res) => res.status(404).end()); // nunca se publican
app.get('/', (req, res) => res.redirect('/login.html'));
app.use(express.static(RAIZ));

// Errores generales (por ejemplo JSON mal formado)
app.use((err, req, res, next) => res.status(400).json({ error: 'Solicitud no válida' }));

const PUERTO = process.env.PORT || 3000;
app.listen(PUERTO, () => console.log(`BamBam listo en http://localhost:${PUERTO}`));
