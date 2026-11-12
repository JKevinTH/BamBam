/* =====================================================
   Corte de caja: conteo por denominación, cuadre e historial
   ===================================================== */
const DENOMINACIONES = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];
let resumen = { ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, total: 0 }, movimientos: [], entradas: 0, salidas: 0 };

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
let cierreManual = false;            // true si el usuario escribió la hora de cierre a mano
const ESTADOS = { cuadrada: 'Caja cuadrada', sobrante: 'Sobrante', faltante: 'Faltante' };

// ---------- Tabla de denominaciones ----------
function pintarDenominaciones(iniciales = {}) {
  $('#denominaciones').innerHTML = DENOMINACIONES.map((d) => `<tr data-den="${d}">
    <td class="denominacion">${dinero(d).replace('.00', '')}</td>
    <td class="numero"><input class="cantidad-input" type="number" min="0" step="1" value="${iniciales[d] || 0}" data-tipo="ini" aria-label="Cantidad inicial de $${d}"></td>
    <td class="numero" data-din="ini"></td>
    <td class="numero"><input class="cantidad-input" type="number" min="0" step="1" value="0" data-tipo="fin" aria-label="Cantidad contada de $${d}"></td>
    <td class="numero" data-din="fin"></td></tr>`).join('');
  calcular();
}

function conteo() {
  return $$('#denominaciones tr').map((tr) => ({
    denominacion: Number(tr.dataset.den),
    inicial: Math.max(0, parseInt($('[data-tipo=ini]', tr).value, 10) || 0),
    final: Math.max(0, parseInt($('[data-tipo=fin]', tr).value, 10) || 0)
  }));
}

// ---------- Cálculos ----------
function calcular() {
  let ci = 0, cf = 0, di = 0, df = 0;
  $$('#denominaciones tr').forEach((tr, n) => {
    const c = conteo()[n];
    $('[data-din=ini]', tr).textContent = dinero(c.denominacion * c.inicial);
    $('[data-din=fin]', tr).textContent = dinero(c.denominacion * c.final);
    ci += c.inicial; cf += c.final; di += c.denominacion * c.inicial; df += c.denominacion * c.final;
  });
  $('#t-cant-ini').textContent = ci; $('#t-din-ini').textContent = dinero(di);
  $('#t-cant-fin').textContent = cf; $('#t-din-fin').textContent = dinero(df);

  const v = resumen.ventas;
  $('#v-efectivo').textContent = dinero(v.efectivo); $('#v-tarjeta').textContent = dinero(v.tarjeta);
  $('#v-transferencia').textContent = dinero(v.transferencia); $('#v-total').textContent = dinero(v.total);

  const esperado = redondear(di + v.efectivo + resumen.entradas - resumen.salidas);
  const diferencia = redondear(df - esperado);
  $('#q-inicial').textContent = dinero(di); $('#q-ventas').textContent = dinero(v.efectivo);
  $('#q-entradas').textContent = dinero(resumen.entradas); $('#q-salidas').textContent = dinero(resumen.salidas);
  $('#q-esperado').textContent = dinero(esperado); $('#q-contado').textContent = dinero(df);
  $('#q-diferencia').textContent = (diferencia > 0 ? '+' : '') + dinero(diferencia);

  const ind = $('#indicador');
  if (df === 0) { ind.className = 'indicador indicador--neutro'; ind.textContent = 'Cuenta el efectivo para ver el resultado'; }
  else {
    const estado = Math.abs(diferencia) < 0.005 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante';
    ind.className = 'indicador indicador--' + estado;
    ind.textContent = estado === 'cuadrada' ? 'Caja cuadrada' : `${ESTADOS[estado]}: ${dinero(Math.abs(diferencia))}`;
  }
  return { inicial: di, contado: df, esperado, diferencia, estado: Math.abs(diferencia) < 0.005 ? 'cuadrada' : diferencia > 0 ? 'sobrante' : 'faltante' };
}

// Mientras la hora de cierre no se edite a mano, se mantiene en "ahora"
function cierreAhora() {
  if (!cierreManual && $('#c-fecha').value === hoyLocal()) $('#c-hasta').value = horaLocal();
}
const masUnMinuto = (hms) => { const m = Number(hms.slice(0, 2)) * 60 + Number(hms.slice(3, 5)) + 1; return String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };

// ---------- Ventas y movimientos del periodo ----------
async function actualizarResumen() {
  const q = new URLSearchParams({ fecha: $('#c-fecha').value, desde: $('#c-desde').value, hasta: $('#c-hasta').value });
  resumen = await api('/caja/resumen?' + q);
  $('#movimientos').innerHTML = resumen.movimientos.length ? resumen.movimientos.map((m) => `<li>
    <div>${esc(m.concepto)}<small>${fechaHora(m.fecha_hora)} · ${esc(cap(m.empleado || ''))}</small></div>
    <span class="mov--${m.tipo}">${m.tipo === 'entrada' ? '+' : '−'}${dinero(m.monto)}</span></li>`).join('')
    : '<li><span class="nota">Sin movimientos en este periodo.</span></li>';
  calcular();
}

async function registrarMovimiento(tipo) {
  const d = await pedirDatos({ titulo: tipo === 'entrada' ? 'Entrada de dinero' : 'Salida de dinero', boton: 'Registrar',
    texto: tipo === 'entrada' ? 'Dinero que entra a la caja sin ser una venta (por ejemplo, fondo extra).' : 'Dinero que sale de la caja (por ejemplo, pago a un proveedor).',
    campos: [{ id: 'monto', label: 'Monto ($)', tipo: 'number', min: 0.01, step: '0.01', requerido: true },
             { id: 'concepto', label: 'Concepto', requerido: true, ancho: 'completo' }] });
  if (!d) return;
  try {
    await api('/caja/movimientos', { metodo: 'POST', cuerpo: { ...d, tipo, claveE: Sesion.empleado.clave } });
    toast('Movimiento registrado');
    cierreAhora();
    await actualizarResumen();
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Guardar ----------
async function guardar() {
  cierreAhora();
  await actualizarResumen();
  const r = calcular();
  if (r.contado === 0 && !(await confirmar('No has contado efectivo. ¿Guardar el corte de todos modos?', 'Guardar'))) return;
  try {
    const g = await api('/caja/cortes', { metodo: 'POST', cuerpo: {
      fecha: $('#c-fecha').value, horai: $('#c-desde').value, horac: $('#c-hasta').value,
      claveE: Sesion.empleado.clave, denominaciones: conteo() } });
    toast(`Corte guardado: ${ESTADOS[g.estado]}`);
    await verReporte(g.idcorte);
    await Promise.all([actualizarResumen(), cargarHistorial()]);
  } catch (e) { toast(e.message, 'error'); }
}

// ---------- Reporte / PDF ----------
const CSS_REPORTE = `body{font-family:Arial,sans-serif;color:#222;margin:24px;font-size:13px}h1{margin:0;font-size:22px}h2{font-size:15px;margin:22px 0 6px}
.sub{color:#666;margin:4px 0 14px}table{width:100%;border-collapse:collapse}th,td{padding:6px 8px;border-bottom:1px solid #ddd;text-align:left}
th{background:#f4eee5;font-size:12px}.d{text-align:right}.r{display:flex;justify-content:space-between;padding:4px 0}.t{font-weight:bold;border-top:1px solid #999;margin-top:4px;padding-top:6px}
.est{margin-top:14px;padding:10px;text-align:center;font-weight:bold;font-size:16px;border:2px solid #222;border-radius:8px}`;

function htmlReporte(c) {
  const ven = [['Efectivo', c.ventas_efectivo], ['Tarjeta', c.ventas_tarjeta], ['Transferencia', c.ventas_transferencia]];
  return `<h1>Pizzería BamBam · Corte de caja</h1>
    <p class="sub">Fecha: ${fechaCorta(c.fecha)} · Horario: ${horaCorta(c.horai)} a ${horaCorta(c.horac)} · Responsable: ${esc(cap(c.empleado || ''))}</p>
    <h2>Ventas del periodo</h2>${ven.map(([n, v]) => `<div class="r"><span>${n}</span><span>${dinero(v)}</span></div>`).join('')}
    <div class="r t"><span>Total de ventas</span><span>${dinero(c.ventas_total)}</span></div>
    <h2>Cuadre de efectivo</h2>
    <div class="r"><span>Efectivo inicial</span><span>${dinero(c.efectivo_inicial)}</span></div>
    <div class="r"><span>+ Ventas en efectivo</span><span>${dinero(c.ventas_efectivo)}</span></div>
    <div class="r"><span>+ Entradas de dinero</span><span>${dinero(c.entradas)}</span></div>
    <div class="r"><span>− Salidas de dinero</span><span>${dinero(c.salidas)}</span></div>
    <div class="r t"><span>Efectivo esperado</span><span>${dinero(c.efectivo_esperado)}</span></div>
    <div class="r"><span>Efectivo contado</span><span>${dinero(c.efectivo_contado)}</span></div>
    <div class="r t"><span>Diferencia</span><span>${dinero(c.diferencia)}</span></div>
    <div class="est">${ESTADOS[c.estado] || 'Sin detalle'}</div>
    ${c.denominaciones.length ? `<h2>Conteo por denominación</h2><table><tr><th>Denominación</th><th class="d">Inicial</th><th class="d">Contada</th><th class="d">Importe contado</th></tr>
      ${c.denominaciones.map((x) => `<tr><td>${dinero(x.denominacion).replace('.00', '')}</td><td class="d">${x.cant_inicial}</td><td class="d">${x.cant_final}</td><td class="d">${dinero(x.denominacion * x.cant_final)}</td></tr>`).join('')}</table>` : ''}
    ${c.movimientos.length ? `<h2>Entradas y salidas de dinero</h2><table>${c.movimientos.map((m) => `<tr><td>${esc(m.concepto)}</td><td>${fechaHora(m.fecha_hora)}</td><td class="d">${m.tipo === 'entrada' ? '+' : '−'}${dinero(m.monto)}</td></tr>`).join('')}</table>` : ''}`;
}

// Reporte del corte que se está armando (todavía sin guardar)
function reporteActual() {
  const r = calcular(), v = resumen.ventas;
  return { fecha: $('#c-fecha').value, horai: $('#c-desde').value, horac: $('#c-hasta').value, empleado: Sesion.empleado.nombre + ' ' + Sesion.empleado.apellido,
    ventas_efectivo: v.efectivo, ventas_tarjeta: v.tarjeta, ventas_transferencia: v.transferencia, ventas_total: v.total,
    efectivo_inicial: r.inicial, entradas: resumen.entradas, salidas: resumen.salidas, efectivo_esperado: r.esperado,
    efectivo_contado: r.contado, diferencia: r.diferencia, estado: r.estado,
    denominaciones: conteo().map((c) => ({ denominacion: c.denominacion, cant_inicial: c.inicial, cant_final: c.final })), movimientos: resumen.movimientos };
}

async function verReporte(id) {
  const c = await api('/caja/cortes/' + id);
  const d = abrirModal(`<div class="modal__form"><h3>Corte #${c.idcorte}</h3>
    <div style="font-size:13px"><style>${CSS_REPORTE.replace(/body\{[^}]*\}/, '')}</style>${htmlReporte(c)}</div>
    <div class="modal__acciones"><button class="boton" data-cerrar>Cerrar</button><button class="boton boton--principal" id="pdf">Exportar a PDF</button></div></div>`, 'modal--ancho');
  $('#pdf', d).onclick = () => imprimirHTML(`Corte de caja ${c.fecha}`, htmlReporte(c), CSS_REPORTE);
}

// ---------- Historial ----------
async function cargarHistorial() {
  const filas = await api('/caja/cortes');
  const tono = { cuadrada: 'ok', sobrante: 'aviso', faltante: 'peligro' };
  $('#historial').innerHTML = filas.length ? filas.map((c) => `<tr>
    <td>${fechaCorta(c.fecha)}</td><td>${horaCorta(c.horai)} – ${horaCorta(c.horac)}</td><td>${esc(cap(c.empleado || '—'))}</td>
    <td class="numero">${dinero(c.ventas_total)}</td><td class="numero">${c.estado ? dinero(c.efectivo_esperado) : '—'}</td>
    <td class="numero">${c.estado ? dinero(c.efectivo_contado) : '—'}</td><td class="numero">${c.estado ? dinero(c.diferencia) : '—'}</td>
    <td>${c.estado ? `<span class="estado estado--${tono[c.estado]}">${ESTADOS[c.estado]}</span>` : '<span class="estado estado--neutro">Sin detalle</span>'}</td>
    <td><button class="boton boton--chico" data-corte="${c.idcorte}">Ver / PDF</button></td></tr>`).join('')
    : '<tr><td colspan="9" class="vacio">Todavía no hay cortes guardados.</td></tr>';
}

// ---------- Arranque ----------
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await iniciarPagina())) return;
  try {
    const u = await api('/caja/ultimo');
    // el efectivo inicial es lo que se contó al cerrar el corte anterior
    const iniciales = {};
    u.denominaciones.forEach((d) => (iniciales[d.denominacion] = d.cantidad));
    pintarDenominaciones(iniciales);
    $('#c-fecha').value = u.hoy;
    $('#c-desde').value = u.ultimo && u.ultimo.fecha === u.hoy ? masUnMinuto(u.ultimo.horac) : '00:00';
    $('#c-hasta').value = u.hora_actual;
    await Promise.all([actualizarResumen(), cargarHistorial()]);
  } catch (e) { return toast(e.message, 'error'); }

  $('#denominaciones').addEventListener('input', calcular);
  const refrescar = () => actualizarResumen().catch((e) => toast(e.message, 'error'));
  $('#actualizar').onclick = () => { cierreManual = false; cierreAhora(); refrescar(); };
  $('#c-hasta').addEventListener('input', () => (cierreManual = true));
  ['#c-fecha', '#c-desde', '#c-hasta'].forEach((s) => $(s).addEventListener('change', refrescar));
  $('#mov-entrada').onclick = () => registrarMovimiento('entrada');
  $('#mov-salida').onclick = () => registrarMovimiento('salida');
  $('#guardar').onclick = guardar;
  $('#exportar').onclick = () => imprimirHTML('Corte de caja ' + $('#c-fecha').value, htmlReporte(reporteActual()), CSS_REPORTE);

  $$('.pestana').forEach((b) => (b.onclick = () => {
    $$('.pestana').forEach((x) => x.classList.toggle('pestana--activa', x === b));
    $('#panel-nuevo').hidden = b.dataset.panel !== 'nuevo';
    $('#panel-historial').hidden = b.dataset.panel !== 'historial';
  }));
  $('#historial').addEventListener('click', (e) => { const b = e.target.closest('[data-corte]'); if (b) verReporte(b.dataset.corte).catch((err) => toast(err.message, 'error')); });
});
