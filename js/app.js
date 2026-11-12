

// Si abres las páginas con Live Server (puerto 5500) el API está en el 3000
const API = location.port === '3000' ? '' : 'http://localhost:3000';

// ---------- Sesión (se guarda en el navegador mientras la pestaña esté abierta) ----------
const Sesion = {
  get token() { return sessionStorage.getItem('token'); },
  get usuario() { return JSON.parse(sessionStorage.getItem('usuario') || 'null'); },
  get empleado() { return JSON.parse(sessionStorage.getItem('empleado') || 'null'); },
  iniciar(token, usuario) {
    sessionStorage.setItem('token', token);
    sessionStorage.setItem('usuario', JSON.stringify(usuario));
    sessionStorage.removeItem('empleado');
  },
  elegir(empleado) { sessionStorage.setItem('empleado', JSON.stringify(empleado)); },
  cerrar() { sessionStorage.clear(); location.href = 'login.html'; }
};

// ---------- Llamadas al servidor ----------
async function api(ruta, { metodo = 'GET', cuerpo } = {}) {
  let r;
  try {
    r = await fetch(API + '/api' + ruta, {
      method: metodo,
      headers: { 'Content-Type': 'application/json', ...(Sesion.token ? { Authorization: 'Bearer ' + Sesion.token } : {}) },
      body: cuerpo ? JSON.stringify(cuerpo) : undefined
    });
  } catch {
    throw new Error('No se pudo conectar con el servidor. ¿Está encendido? (npm start)');
  }
  const datos = await r.json().catch(() => ({}));
  if (r.status === 401 && ruta !== '/login') { Sesion.cerrar(); throw new Error('Tu sesión expiró'); }
  if (!r.ok) throw new Error(datos.error || 'Ocurrió un error');
  return datos;
}

// ---------- Utilidades ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const dinero = (n) => '$' + Number(n || 0).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cantidadTxt = (n) => Number(Number(n || 0).toFixed(3)).toLocaleString('es-MX');
const cap = (t) => String(t || '').replace(/^./, (c) => c.toUpperCase());
const fechaCorta = (f) => (f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : '—');
const horaCorta = (h) => (h ? h.slice(0, 5) : '—');
const fechaHora = (s) => (s ? fechaCorta(s) + ' ' + s.slice(11, 16) : '—');
const hoyLocal = () => new Date().toLocaleDateString('en-CA');
const horaLocal = () => new Date().toTimeString().slice(0, 5);

function etiquetaEstado(estado) {
  const e = { stock: ['ok', 'En stock'], bajo: ['aviso', 'Bajo'], agotado: ['peligro', 'Agotado'] }[estado] || ['neutro', cap(estado)];
  return `<span class="estado estado--${e[0]}">${e[1]}</span>`;
}

function toast(mensaje, tipo = 'ok') {
  let c = $('#toasts');
  if (!c) { c = document.createElement('div'); c.id = 'toasts'; document.body.appendChild(c); }
  const t = document.createElement('div');
  t.className = 'toast toast--' + tipo;
  t.textContent = mensaje;
  c.appendChild(t);
  setTimeout(() => t.remove(), tipo === 'error' ? 5000 : 3200);
}

// ---------- Ventanas (modales) ----------
function abrirModal(html, clase = '') {
  const d = document.createElement('dialog');
  d.className = 'modal ' + clase;
  d.innerHTML = html;
  document.body.appendChild(d);
  d.addEventListener('close', () => d.remove());
  d.showModal();
  $$('[data-cerrar]', d).forEach((b) => (b.onclick = () => d.close()));
  return d;
}

function campoHTML(c) {
  const id = 'f_' + c.id, req = c.requerido ? 'required' : '';
  let control;
  if (c.tipo === 'select') {
    control = `<select id="${id}" ${req}>${(c.opciones || []).map((o) =>
      `<option value="${esc(o.valor)}" ${String(o.valor) === String(c.valor ?? '') ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}</select>`;
  } else if (c.tipo === 'textarea') {
    control = `<textarea id="${id}" rows="2" ${req}>${esc(c.valor)}</textarea>`;
  } else {
    control = `<input id="${id}" type="${c.tipo || 'text'}" value="${esc(c.valor)}" ${req}
      ${c.min !== undefined ? `min="${c.min}"` : ''} ${c.max !== undefined ? `max="${c.max}"` : ''}
      ${c.step ? `step="${c.step}"` : ''} ${c.placeholder ? `placeholder="${esc(c.placeholder)}"` : ''}>`;
  }
  return `<div class="campo ${c.ancho === 'completo' ? 'campo--completo' : ''}"><label for="${id}">${esc(c.label)}</label>${control}${c.ayuda ? `<small>${esc(c.ayuda)}</small>` : ''}</div>`;
}

// Muestra un formulario y devuelve los valores (o null si se cancela)
function pedirDatos({ titulo, campos, boton = 'Guardar', texto = '' }) {
  return new Promise((resolver) => {
    let listo = false;
    const d = abrirModal(`<form method="dialog" class="modal__form">
      <h3>${esc(titulo)}</h3>${texto ? `<p class="modal__texto">${esc(texto)}</p>` : ''}
      <div class="campos">${campos.map(campoHTML).join('')}</div>
      <div class="modal__acciones"><button type="button" class="boton" data-cerrar>Cancelar</button>
      <button class="boton boton--principal">${esc(boton)}</button></div></form>`);
    $('form', d).addEventListener('submit', () => {
      const valores = {};
      campos.forEach((c) => {
        const v = $('#f_' + c.id, d).value;
        valores[c.id] = c.tipo === 'number' ? (v === '' ? null : Number(v)) : v.trim();
      });
      listo = true; resolver(valores);
    });
    d.addEventListener('close', () => { if (!listo) resolver(null); });
  });
}

function confirmar(mensaje, boton = 'Aceptar') {
  return new Promise((resolver) => {
    let ok = false;
    const d = abrirModal(`<form method="dialog" class="modal__form"><h3>${esc(mensaje)}</h3>
      <div class="modal__acciones"><button type="button" class="boton" data-cerrar>Cancelar</button>
      <button class="boton boton--principal">${esc(boton)}</button></div></form>`);
    $('form', d).addEventListener('submit', () => { ok = true; });
    d.addEventListener('close', () => resolver(ok));
  });
}

// Imprimer (o guarda como PDF)
function imprimirHTML(titulo, cuerpo, css = '') {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
  document.body.appendChild(f);
  const d = f.contentWindow.document;
  d.open();
  d.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(titulo)}</title><style>${css}</style></head><body>${cuerpo}</body></html>`);
  d.close();
  setTimeout(() => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 1500); }, 250);
}

// El usuario y empleado 
function pintarUsuario() {
  const caja = $('.inicio_usuario');
  if (!caja || !Sesion.usuario) return;
  const e = Sesion.empleado;
  caja.innerHTML = `<button type="button" title="Cambiar de empleado">Usuario: ${esc(cap(Sesion.nombre))}${e ? ` · ${esc(cap(e.nombre))}` : ''}</button>`;
  $('button', caja).onclick = elegirEmpleado;
}

async function elegirEmpleado() {
  const lista = await api('/empleados');
  return new Promise((resolver) => {
    const d = abrirModal(`<div class="modal__form"><h3>¿Quién está en caja?</h3>
      <p class="modal__texto">Su nombre se guarda en cada venta, movimiento y corte.</p>
      <div class="lista-empleados">${lista.map((e) => `<button class="empleado-opcion" data-clave="${esc(e.clave)}">
        <strong>${esc(cap(e.nombre))} ${esc(cap(e.apellido))}</strong><span>${esc(cap(e.rol))}</span></button>`).join('')}</div></div>`);
    $$('.empleado-opcion', d).forEach((b) => (b.onclick = () => {
      const e = lista.find((x) => x.clave === b.dataset.clave);
      Sesion.elegir(e); pintarUsuario(); d.close(); resolver(e);
    }));
    d.addEventListener('cancel', (ev) => { if (!Sesion.empleado) ev.preventDefault(); });
  });
}

// Se llama al inicio de cada página: pide sesión y empleado
async function iniciarPagina() {
  if (!Sesion.token) { location.href = 'login.html'; return false; }
  pintarUsuario();
  try { if (!Sesion.empleado) await elegirEmpleado(); }
  catch (e) { toast(e.message, 'error'); return false; }
  return true;
}
