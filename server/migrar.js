// Ejecuta database/02_migracion_pos.sql y se puede repetir sin problema:
// los pasos que ya estaban aplicados se omiten.
const fs = require('fs');
const path = require('path');
const pool = require('./db');

const YA_EXISTE = [1060, 1061, 1826, 1050, 1062];   // columna, índice, llave foránea, tabla o dato duplicado

(async () => {
  const sql = fs.readFileSync(path.join(__dirname, '..', 'database', '02_migracion_pos.sql'), 'utf8');
  const sentencias = sql.split('\n').filter((l) => !l.trim().startsWith('--')).join('\n')
    .split(/;\s*\n/).map((s) => s.trim()).filter(Boolean);

  let aplicadas = 0, omitidas = 0;
  for (const s of sentencias) {
    try { await pool.query(s); aplicadas++; }
    catch (e) {
      if (YA_EXISTE.includes(e.errno)) { omitidas++; continue; }
      console.error('\nError en esta sentencia:\n', s.slice(0, 200), '\n', e.message);
      process.exit(1);
    }
  }
  console.log(`Migración lista: ${aplicadas} cambios aplicados, ${omitidas} ya estaban hechos.`);
  process.exit(0);
})();
