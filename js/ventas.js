
let productos = [];
let promos = [];
const carrito = new Map();          // id_producto -> { producto, cantidad }
let categoria = '';
let metodo = 'efectivo';

const redondear = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

// ---------- Catálogo ----------
function pintarProductos() {
  const q = $('#buscar-producto').value.trim().toLowerCase();
  const lista = productos.filter((p) => (!categoria || p.categoria === categoria) && p.nombre.toLowerCase().includes(q));
  $('#productos').innerHTML = lista.length
    ? lista.map((p) => `<button class="producto" data-id="${p.id_producto}">
        <img src="${esc(p.imagen || 'Img/pizza.png')}" alt="">
        <strong>${esc(p.nombre)}</strong><span>${dinero(p.precio)}</span></button>`).join('')
    : '<p class="vacio">No hay productos en esta categoría.</p>';
}

// ---------- Pedido ----------
function agregar(id, delta) {
  const actual = carrito.get(id);
  const cantidad = (actual ? actual.cantidad : 0) + delta;
  if (cantidad <= 0) carrito.delete(id);
  else carrito.set(id, { producto: productos.find((p) => p.id_producto === id), cantidad: Math.min(cantidad, 99) });
  pintarCarrito();
}

function lineasHTML(editable) {
  if (!carrito.size) return '<p class="vacio">Toca un producto para agregarlo.</p>';
  return [...carrito.values()].map(({ producto: p, cantidad }) => `
    <div class="linea">
      <div><div class="linea__nombre">${esc(p.nombre)}</div><div class="linea__precio">${dinero(p.precio)} c/u</div></div>
      <div class="linea__importe">${dinero(p.precio * cantidad)}</div>
      ${editable ? `<div class="cantidad">
          <button data-menos="${p.id_producto}" aria-label="Quitar uno de ${esc(p.nombre)}">−</button>
          <span>${cantidad}</span>
          <button data-mas="${p.id_producto}" aria-label="Agregar uno de ${esc(p.nombre)}">+</button>
          <button class="quitar" data-quitar="${p.id_producto}">Quitar</button></div>` : `<div class="linea__precio">Cantidad: ${cantidad}</div>`}
    </div>`).join('');
}

function pintarCarrito() {
  $('#carrito').innerHTML = lineasHTML(true);
  $('#carrito-subtotal').textContent = dinero(calcular().subtotal);
  $('#ir-cobro').disabled = !carrito.size;
  $('#vaciar').disabled = !carrito.size;
}

// Cálculos (el servidor los repite y es quien manda)
function calcular() {
  const subtotal = redondear([...carrito.values()].reduce((s, l) => s + l.producto.precio * l.cantidad, 0));
  let promo = 0, promoNombre = '';
  if ($('#aplicar-promo').checked)
    for (const p of promos) {
      if (subtotal < p.compra_minima) continue;
      const valor = p.tipo === 'porcentaje' ? subtotal * p.valor / 100 : p.valor;
      if (valor > promo) { promo = valor; promoNombre = p.nombre; }
    }
  const v = Number($('#desc-valor').value) || 0;
  const manual = $('#desc-tipo').value === 'porcentaje' ? subtotal * Math.min(v, 100) / 100 : v;
  const descuento = redondear(Math.min(subtotal, promo + manual));
  return { subtotal, promo: redondear(promo), promoNombre, manual: redondear(manual), descuento, total: redondear(subtotal - descuento) };
}

function pintarCobro() {
  $('#cobro-lineas').innerHTML = lineasHTML(false);
  const c = calcular();

  // promoción automática disponible
  const mejor = promos.length ? promos[0] : null;
  $('#bloque-promo').hidden = !mejor;
  if (mejor) {
    const texto = mejor.tipo === 'porcentaje' ? `${mejor.valor}%` : dinero(mejor.valor);
    $('#promo-texto').textContent = c.subtotal >= mejor.compra_minima
      ? `Promoción automática: ${mejor.nombre} (${texto} de descuento)`
      : `Promoción: ${mejor.nombre} (se aplica al llegar a ${dinero(mejor.compra_minima)})`;
  }

  $('#cobro-totales').innerHTML = `
    <div><dt>Subtotal</dt><dd>${dinero(c.subtotal)}</dd></div>
    ${c.promo ? `<div class="descuento"><dt>Promoción</dt><dd>−${dinero(c.promo)}</dd></div>` : ''}
    ${c.manual ? `<div class="descuento"><dt>Descuento manual</dt><dd>−${dinero(Math.min(c.manual, c.subtotal - c.promo))}</dd></div>` : ''}
    <div class="total"><dt>Total</dt><dd>${dinero(c.total)}</dd></div>`;

  // billetes rápidos
  const sugeridos = [...new Set([Math.ceil(c.total), ...[50, 100, 200, 500, 1000].filter((b) => b >= c.total)])].slice(0, 4);
  $('#rapidos').innerHTML = sugeridos.map((b, i) => `<button data-rapido="${b}">${i === 0 && b === Math.ceil(c.total) ? 'Exacto ' : ''}${dinero(b)}</button>`).join('');

  // cambio y botón de finalizar
  const caja = $('#cambio-caja');
  caja.className = 'cambio';
  let valido = true;
  if (metodo === 'efectivo') {
    const recibido = Number($('#recibido').value) || 0;
    const dif = redondear(recibido - c.total);
    $('#cambio-etiqueta').textContent = dif < 0 ? 'Faltan' : 'Cambio';
    $('#cambio').textContent = dinero(Math.abs(dif));
    caja.classList.add(dif < 0 ? 'cambio--falta' : 'cambio--ok');
    valido = dif >= 0 && recibido > 0 || c.total === 0;
  } else {
    $('#cambio-etiqueta').textContent = 'Cambio';
    $('#cambio').textContent = dinero(0);
  }
  $('#finalizar').disabled = !carrito.size || !valido;
}

function irAPaso(n) {
  $('#paso-1').hidden = n !== 1;
  $('#paso-2').hidden = n !== 2;
  $('#indicador-1').className = 'paso ' + (n === 1 ? 'paso--activo' : 'paso--hecho');
  $('#indicador-2').className = 'paso ' + (n === 2 ? 'paso--activo' : '');
  if (n === 2) pintarCobro();
}

function reiniciar() {
  carrito.clear();
  $('#recibido').value = ''; $('#desc-valor').value = ''; $('#aplicar-promo').checked = true;
  metodo = 'efectivo';
  $$('.metodo').forEach((b) => b.classList.toggle('metodo--activo', b.dataset.metodo === 'efectivo'));
  $('#bloque-efectivo').hidden = false;
  pintarCarrito(); irAPaso(1);
}

// Finalizar venta
async function finalizar() {
  const boton = $('#finalizar');
  boton.disabled = true;
  try {
    const r = await api('/ventas', { metodo: 'POST', cuerpo: {
      claveE: Sesion.empleado.clave,
      items: [...carrito.entries()].map(([id, l]) => ({ id_producto: id, cantidad: l.cantidad })),
      tipo_pago: metodo,
      aplicar_promo: $('#aplicar-promo').checked,
      descuento_manual_tipo: $('#desc-tipo').value,
      descuento_manual_valor: Number($('#desc-valor').value) || 0,
      recibido: Number($('#recibido').value) || 0
    } });
    toast(`Venta #${r.ticket.folio} registrada`);
    r.advertencias.forEach((a) => toast(a, 'aviso'));
    reiniciar();
    mostrarTicket(r.ticket);
  } catch (e) { toast(e.message, 'error'); boton.disabled = false; }
}

//Ticket
const CSS_TICKET = `body{font-family:monospace;font-size:12px;width:72mm;margin:0 auto;padding:4mm 0;color:#000}
h1{font-size:16px;text-align:center;margin:0}p{margin:2px 0}.c{text-align:center}hr{border:0;border-top:1px dashed #000;margin:6px 0}
table{width:100%;border-collapse:collapse}td{padding:1px 0;vertical-align:top}.d{text-align:right}.t{font-size:15px;font-weight:bold}`;

function htmlTicket(t) {
  const metodoTxt = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia' }[t.tipo_pago] || t.tipo_pago;
  return `<h1>PIZZERÍA BAMBAM</h1><p class="c">Tan fuerte como su sabor</p><hr>
    <p>Folio: <b>${t.folio}</b></p><p>Fecha: ${fechaHora(t.fecha_hora)}</p><p>Atendió: ${esc(cap(t.empleado || ''))}</p><hr>
    <table>${t.lineas.map((l) => `<tr><td>${l.cantidad} x ${esc(l.producto)}</td><td class="d">${dinero(l.importe)}</td></tr>
      <tr><td colspan="2">&nbsp;&nbsp;${dinero(l.precio)} c/u</td></tr>`).join('')}</table><hr>
    <table><tr><td>Subtotal</td><td class="d">${dinero(t.subtotal)}</td></tr>
    ${t.descuento > 0 ? `<tr><td>Descuento</td><td class="d">-${dinero(t.descuento)}</td></tr>` : ''}
    <tr class="t"><td>TOTAL</td><td class="d">${dinero(t.total)}</td></tr>
    <tr><td>Pago (${metodoTxt})</td><td class="d">${dinero(t.recibido)}</td></tr>
    <tr><td>Cambio</td><td class="d">${dinero(t.cambio)}</td></tr></table><hr><p class="c">¡Gracias por tu compra!</p>`;
}

function mostrarTicket(t) {
  const d = abrirModal(`<div class="modal__form"><h3>Ticket #${t.folio}</h3>
    <div style="border:1px dashed var(--borde);border-radius:12px;padding:14px;background:#fff"><style>${CSS_TICKET.replace(/body\{[^}]*\}/, '')}</style>${htmlTicket(t)}</div>
    <div class="modal__acciones"><button class="boton" data-cerrar>Cerrar</button>
    <button class="boton boton--principal" id="imprimir">Imprimir ticket</button></div></div>`);
  $('#imprimir', d).onclick = () => imprimirHTML('Ticket ' + t.folio, htmlTicket(t), CSS_TICKET);
}

// Historial 
async function cargarHistorial() {
  try {
    const r = await api(`/ventas?desde=${$('#hist-desde').value}&hasta=${$('#hist-hasta').value}`);
    $('#hist-cantidad').textContent = r.resumen.cantidad;
    $('#hist-total').textContent = dinero(r.resumen.total);
    $('#hist-cuerpo').innerHTML = r.ventas.length ? r.ventas.map((v) => `<tr>
      <td><b>#${v.folio}</b></td><td>${fechaHora(v.fecha_hora)}</td><td>${esc(cap(v.empleado || '—'))}</td>
      <td>${esc(cap(v.tipo_pago))}</td><td class="numero">${dinero(v.subtotal)}</td><td class="numero">${dinero(v.descuento)}</td>
      <td class="numero"><b>${dinero(v.total)}</b></td>
      <td><button class="boton boton--chico" data-ticket="${v.folio}">Ver ticket</button></td></tr>`).join('')
      : '<tr><td colspan="8" class="vacio">No hay ventas en este periodo.</td></tr>';
  } catch (e) { toast(e.message, 'error'); }
}

// Arranque 
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await iniciarPagina())) return;
  try { [productos, promos] = await Promise.all([api('/productos'), api('/promociones')]); }
  catch (e) { return toast(e.message, 'error'); }
  pintarProductos(); pintarCarrito();
  $('#hist-desde').value = $('#hist-hasta').value = hoyLocal();

  // pestañas
  $$('.pestana').forEach((b) => (b.onclick = () => {
    $$('.pestana').forEach((x) => x.classList.toggle('pestana--activa', x === b));
    $('#panel-venta').hidden = b.dataset.panel !== 'venta';
    $('#panel-historial').hidden = b.dataset.panel !== 'historial';
    if (b.dataset.panel === 'historial') cargarHistorial();
  }));

  // catálogo
  $('#categorias').addEventListener('click', (e) => {
    const b = e.target.closest('.chip'); if (!b) return;
    categoria = b.dataset.categoria;
    $$('.chip').forEach((x) => x.classList.toggle('chip--activo', x === b));
    pintarProductos();
  });
  $('#buscar-producto').addEventListener('input', pintarProductos);
  $('#productos').addEventListener('click', (e) => { const b = e.target.closest('.producto'); if (b) agregar(Number(b.dataset.id), 1); });

  // pedido
  $('#carrito').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.mas) agregar(Number(t.dataset.mas), 1);
    if (t.dataset.menos) agregar(Number(t.dataset.menos), -1);
    if (t.dataset.quitar) { carrito.delete(Number(t.dataset.quitar)); pintarCarrito(); }
  });
  $('#vaciar').onclick = async () => { if (await confirmar('¿Vaciar el pedido?', 'Vaciar')) reiniciar(); };
  $('#ir-cobro').onclick = () => irAPaso(2);
  $('#volver').onclick = () => irAPaso(1);

  // cobro
  ['#aplicar-promo', '#desc-tipo', '#desc-valor', '#recibido'].forEach((s) => $(s).addEventListener('input', pintarCobro));
  $('#rapidos').addEventListener('click', (e) => { const b = e.target.closest('[data-rapido]'); if (b) { $('#recibido').value = b.dataset.rapido; pintarCobro(); } });
  $$('.metodo').forEach((b) => (b.onclick = () => {
    metodo = b.dataset.metodo;
    $$('.metodo').forEach((x) => x.classList.toggle('metodo--activo', x === b));
    $('#bloque-efectivo').hidden = metodo !== 'efectivo';
    pintarCobro();
  }));
  $('#finalizar').onclick = finalizar;

  // historial
  $('#hist-buscar').onclick = cargarHistorial;
  $('#hist-cuerpo').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-ticket]'); if (!b) return;
    try { mostrarTicket(await api('/ventas/' + b.dataset.ticket)); } catch (err) { toast(err.message, 'error'); }
  });
});
