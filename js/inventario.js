
let items = [];
let diasAviso = 7;
let proveedores = [];
let catalogo = [];                 // productos (para recetas)
let seleccionado = null;           // producto abierto en el editor
let receta = [];                   // filas del editor: { codigo, cantidad }

const opcionesProveedor = () => [{ valor: '', texto: 'Sin proveedor' }, ...proveedores.filter((p) => p.activo).map((p) => ({ valor: p.id_proveedor, texto: p.nombre }))];
const UNIDADES = ['kg', 'g', 'Lt', 'ml', 'un'].map((u) => ({ valor: u, texto: u }));

//EXISTENCIAS
async function cargarExistencias() {
  const q = new URLSearchParams({ buscar: $('#buscar').value.trim(), categoria: $('#filtro-categoria').value });
  const r = await api('/inventario?' + q);
  items = r.items; diasAviso = r.dias_aviso_caducidad;
  pintarExistencias();
}

async function cargarCategorias() {
  const actual = $('#filtro-categoria').value;
  const cats = await api('/inventario/categorias');
  $('#filtro-categoria').innerHTML = '<option value="">Todas las categorías</option>' + cats.map((c) => `<option value="${esc(c)}">${esc(cap(c))}</option>`).join('');
  $('#filtro-categoria').value = actual;
}

function pintarExistencias() {
  const bajos = items.filter((i) => i.estado !== 'stock');
  const porCaducar = items.filter((i) => i.dias_caducidad !== null && i.dias_caducidad <= diasAviso && i.cantidad > 0);
  $('#kpi-total').textContent = items.length;
  $('#kpi-bajo').textContent = bajos.length;
  $('#kpi-caducar').textContent = porCaducar.length;
  $('#kpi-valor').textContent = dinero(items.reduce((s, i) => s + i.cantidad * i.costo_unitario, 0));
  $('#kpi-bajo-caja').classList.toggle('kpi--aviso', bajos.length > 0);

  // alertas de inventario bajo y de caducidad
  const alertas = [
    ...bajos.map((i) => `<div class="alerta ${i.estado === 'agotado' ? 'alerta--roja' : ''}"><b>${i.estado === 'agotado' ? 'Agotado' : 'Inventario bajo'}:</b> ${esc(cap(i.nombre))}
      — quedan ${cantidadTxt(i.cantidad)} ${esc(i.unidad)} (mínimo ${cantidadTxt(i.stock_minimo)})</div>`),
    ...porCaducar.map((i) => `<div class="alerta ${i.dias_caducidad < 0 ? 'alerta--roja' : ''}"><b>${i.dias_caducidad < 0 ? 'Caducado' : 'Por caducar'}:</b> ${esc(cap(i.nombre))}
      — ${i.dias_caducidad < 0 ? 'venció el ' : 'caduca el '}${fechaCorta(i.caducidad)}</div>`)
  ];
  $('#alertas').hidden = !alertas.length;
  $('#alertas').innerHTML = alertas.join('');

  $('#cuerpo-existencias').innerHTML = items.length ? items.map((i) => {
    const clase = i.dias_caducidad === null ? '' : i.dias_caducidad < 0 ? 'caduca--vencido' : i.dias_caducidad <= diasAviso ? 'caduca--pronto' : '';
    return `<tr>
      <td class="nombre">${esc(cap(i.nombre))}</td><td>${esc(cap(i.categoria))}</td>
      <td class="numero"><b>${cantidadTxt(i.cantidad)}</b> ${esc(i.unidad)}</td>
      <td class="numero">${cantidadTxt(i.stock_minimo)} ${esc(i.unidad)}</td>
      <td>${etiquetaEstado(i.estado)}</td>
      <td class="${clase}">${i.caducidad ? fechaCorta(i.caducidad) : '—'}</td>
      <td>${esc(i.proveedor || '—')}</td>
      <td class="numero">${i.costo_unitario ? dinero(i.costo_unitario) : '—'}</td>
      <td><div class="acciones">
        <button class="boton boton--chico" data-mov="entrada" data-codigo="${i.codigo}">Entrada</button>
        <button class="boton boton--chico" data-mov="salida" data-codigo="${i.codigo}">Salida</button>
        <button class="boton boton--chico" data-mov="ajuste" data-codigo="${i.codigo}">Ajustar</button>
        <button class="boton boton--chico" data-editar="${i.codigo}">Editar</button></div></td></tr>`;
  }).join('') : '<tr><td colspan="9" class="vacio">No se encontraron ingredientes.</td></tr>';
}

async function registrarMovimiento(tipo, codigo) {
  const i = items.find((x) => x.codigo === codigo);
  const nombre = cap(i.nombre);
  let campos, titulo, texto;
  if (tipo === 'entrada') {
    titulo = `Entrada de mercancía: ${nombre}`; texto = `Existencia actual: ${cantidadTxt(i.cantidad)} ${i.unidad}`;
    campos = [
      { id: 'cantidad', label: `Cantidad recibida (${i.unidad})`, tipo: 'number', min: 0, step: 'any', requerido: true },
      { id: 'costo_unitario', label: `Costo por ${i.unidad}`, tipo: 'number', min: 0, step: '0.01', valor: i.costo_unitario || '' },
      { id: 'id_proveedor', label: 'Proveedor', tipo: 'select', opciones: opcionesProveedor(), valor: i.id_proveedor || '' },
      { id: 'caducidad', label: 'Fecha de caducidad', tipo: 'date', valor: i.caducidad || '' },
      { id: 'motivo', label: 'Nota (factura, lote...)', ancho: 'completo' }
    ];
  } else if (tipo === 'salida') {
    titulo = `Salida de ingrediente: ${nombre}`; texto = `Existencia actual: ${cantidadTxt(i.cantidad)} ${i.unidad}`;
    campos = [
      { id: 'cantidad', label: `Cantidad (${i.unidad})`, tipo: 'number', min: 0, step: 'any', requerido: true },
      { id: 'motivo', label: 'Motivo', tipo: 'select', opciones: ['Consumo interno', 'Merma', 'Caducado', 'Otro'].map((m) => ({ valor: m, texto: m })) }
    ];
  } else {
    titulo = `Ajustar existencias: ${nombre}`; texto = 'Escribe la cantidad real que contaste. El sistema registra la diferencia.';
    campos = [
      { id: 'cantidad', label: `Existencia real (${i.unidad})`, tipo: 'number', min: 0, step: 'any', requerido: true, valor: i.cantidad },
      { id: 'motivo', label: 'Motivo del ajuste', placeholder: 'Ej. conteo físico', ancho: 'completo' }
    ];
  }
  const d = await pedirDatos({ titulo, texto, campos, boton: 'Registrar' });
  if (!d) return;
  try {
    await api(`/inventario/${codigo}/movimiento`, { metodo: 'POST', cuerpo: { ...d, tipo, claveE: Sesion.empleado.clave } });
    toast('Movimiento registrado');
    await cargarExistencias();
  } catch (e) { toast(e.message, 'error'); }
}

function camposIngrediente(i = {}, nuevo = false) {
  return [
    { id: 'nombre', label: 'Nombre', requerido: true, valor: i.nombre ? cap(i.nombre) : '', ancho: 'completo' },
    { id: 'categoria', label: 'Categoría', requerido: true, valor: i.categoria || '', placeholder: 'Ej. carnes, base, empaque' },
    { id: 'unidad', label: 'Unidad', tipo: 'select', opciones: UNIDADES, valor: i.unidad || 'kg' },
    ...(nuevo ? [{ id: 'cantidad', label: 'Existencia inicial', tipo: 'number', min: 0, step: 'any', valor: 0 }] : []),
    { id: 'stock_minimo', label: 'Stock mínimo (alerta)', tipo: 'number', min: 0, step: 'any', valor: i.stock_minimo ?? 0 },
    { id: 'costo_unitario', label: 'Costo por unidad', tipo: 'number', min: 0, step: '0.01', valor: i.costo_unitario ?? 0 },
    { id: 'id_proveedor', label: 'Proveedor', tipo: 'select', opciones: opcionesProveedor(), valor: i.id_proveedor || '' },
    { id: 'caducidad', label: 'Fecha de caducidad', tipo: 'date', valor: i.caducidad || '' }
  ];
}

async function guardarIngrediente(codigo) {
  const i = codigo ? items.find((x) => x.codigo === codigo) : null;
  const d = await pedirDatos({ titulo: i ? `Editar: ${cap(i.nombre)}` : 'Nuevo ingrediente', campos: camposIngrediente(i || {}, !i), boton: 'Guardar' });
  if (!d) return;
  try {
    if (i) await api('/inventario/' + codigo, { metodo: 'PUT', cuerpo: d });
    else await api('/inventario', { metodo: 'POST', cuerpo: { ...d, claveE: Sesion.empleado.clave } });
    toast('Ingrediente guardado');
    await Promise.all([cargarCategorias(), cargarExistencias()]);
  } catch (e) { toast(e.message, 'error'); }
}

//MOVIMIENTOS 
async function cargarMovimientos() {
  const q = new URLSearchParams({ tipo: $('#mov-tipo').value, buscar: $('#mov-buscar').value.trim() });
  const filas = await api('/movimientos?' + q);
  const tipos = { entrada: ['ok', 'Entrada'], salida: ['peligro', 'Salida'], ajuste: ['neutro', 'Ajuste'], venta: ['aviso', 'Venta'] };
  $('#cuerpo-movimientos').innerHTML = filas.length ? filas.map((m) => `<tr>
    <td>${fechaHora(m.fecha_hora)}</td><td class="nombre">${esc(cap(m.ingrediente))}</td>
    <td><span class="estado estado--${tipos[m.tipo][0]}">${tipos[m.tipo][1]}</span></td>
    <td class="numero ${m.cantidad >= 0 ? 'entrada' : 'salida'}">${m.cantidad > 0 ? '+' : ''}${cantidadTxt(m.cantidad)} ${esc(m.unidad)}</td>
    <td class="numero">${cantidadTxt(m.existencia_anterior)} → ${cantidadTxt(m.existencia_nueva)}</td>
    <td class="numero">${m.costo_unitario ? dinero(m.costo_unitario) : '—'}</td><td>${esc(m.proveedor || '—')}</td>
    <td>${esc(m.motivo || '—')}</td><td>${esc(cap(m.empleado || '—'))}</td></tr>`).join('')
    : '<tr><td colspan="9" class="vacio">Todavía no hay movimientos.</td></tr>';
}

//  RECETAS Y PRODUCTOS 
async function cargarCatalogo() {
  catalogo = await api('/productos?todos=1');
  const grupos = { pizza: 'Pizzas', bebida: 'Bebidas', complemento: 'Complementos' };
  $('#lista-productos').innerHTML = Object.entries(grupos).map(([cat, nombre]) => {
    const lista = catalogo.filter((p) => p.categoria === cat);
    return lista.length ? `<div class="grupo-titulo">${nombre}</div>` + lista.map((p) => `
      <button class="item-producto ${seleccionado === p.id_producto ? 'item-producto--activo' : ''} ${p.activo ? '' : 'item-producto--inactivo'}" data-producto="${p.id_producto}">
        <img src="${esc(p.imagen || 'Img/pizza.png')}" alt=""><div><strong>${esc(p.nombre)}</strong><span>${dinero(p.precio)}${p.activo ? '' : ' · inactivo'}</span></div></button>`).join('') : '';
  }).join('');
}

async function abrirProducto(id) {
  seleccionado = id;
  const p = id ? catalogo.find((x) => x.id_producto === id) : { nombre: '', categoria: 'pizza', precio: '', imagen: '', activo: 1 };
  receta = id ? (await api(`/productos/${id}/receta`)).map((r) => ({ codigo: r.codigo, cantidad: r.cantidad })) : [];
  if (!items.length) await cargarExistencias();
  pintarEditor(p);
  cargarCatalogo();
}

function pintarEditor(p) {
  const ing = items.map((i) => ({ valor: i.codigo, texto: cap(i.nombre) }));
  $('#editor').innerHTML = `
    <h2>${p.nombre ? esc(p.nombre) : 'Nuevo producto'}</h2>
    <div class="campos">
      ${campoHTML({ id: 'p_nombre', label: 'Nombre', valor: p.nombre, requerido: true })}
      ${campoHTML({ id: 'p_categoria', label: 'Categoría', tipo: 'select', valor: p.categoria, opciones: [{ valor: 'pizza', texto: 'Pizza' }, { valor: 'bebida', texto: 'Bebida' }, { valor: 'complemento', texto: 'Complemento' }] })}
      ${campoHTML({ id: 'p_precio', label: 'Precio de venta ($)', tipo: 'number', valor: p.precio, min: 0, step: '0.5', requerido: true })}
      ${campoHTML({ id: 'p_imagen', label: 'Imagen (ruta)', valor: p.imagen, placeholder: 'Img/productos/mi-pizza.svg' })}
      ${campoHTML({ id: 'p_activo', label: 'Disponible para venta', tipo: 'select', valor: p.activo ? 1 : 0, opciones: [{ valor: 1, texto: 'Sí' }, { valor: 0, texto: 'No' }] })}
    </div>
    <div>
      <h3>Receta (lo que se descuenta del inventario por cada unidad vendida)</h3>
      <div id="filas-receta"></div>
      <button class="boton boton--chico" id="agregar-ingrediente">+ Agregar ingrediente</button>
      <p class="nota" id="nota-receta"></p>
    </div>
    <div class="acciones"><button class="boton boton--principal" id="guardar-producto">Guardar producto y receta</button></div>`;
  pintarFilasReceta(ing);
  $('#agregar-ingrediente').onclick = () => { receta.push({ codigo: items[0]?.codigo, cantidad: 1 }); pintarFilasReceta(ing); };
  $('#guardar-producto').onclick = guardarProducto;
}

function pintarFilasReceta(ing) {
  $('#filas-receta').innerHTML = receta.map((r, n) => {
    const unidad = items.find((i) => i.codigo === Number(r.codigo))?.unidad || '';
    return `<div class="fila-ingrediente" data-fila="${n}">
      <select aria-label="Ingrediente">${ing.map((o) => `<option value="${o.valor}" ${Number(o.valor) === Number(r.codigo) ? 'selected' : ''}>${esc(o.texto)}</option>`).join('')}</select>
      <input type="number" min="0" step="any" value="${r.cantidad}" aria-label="Cantidad">
      <span class="unidad">${esc(unidad)}</span>
      <button class="boton boton--chico boton--peligro" data-quitar-fila="${n}">Quitar</button></div>`;
  }).join('');
  $('#nota-receta').textContent = receta.length ? '' : 'Sin receta: al vender este producto no se descuenta nada del inventario.';
  $$('.fila-ingrediente').forEach((f) => {
    const n = Number(f.dataset.fila);
    $('select', f).onchange = (e) => { receta[n].codigo = Number(e.target.value); pintarFilasReceta(ing); };
    $('input', f).oninput = (e) => { receta[n].cantidad = Number(e.target.value); };
    $('[data-quitar-fila]', f).onclick = () => { receta.splice(n, 1); pintarFilasReceta(ing); };
  });
}

async function guardarProducto() {
  const datos = {
    nombre: $('#f_p_nombre').value.trim(), categoria: $('#f_p_categoria').value,
    precio: Number($('#f_p_precio').value), imagen: $('#f_p_imagen').value.trim(), activo: Number($('#f_p_activo').value) === 1
  };
  try {
    let id = seleccionado;
    if (id) await api('/productos/' + id, { metodo: 'PUT', cuerpo: datos });
    else id = (await api('/productos', { metodo: 'POST', cuerpo: datos })).id_producto;
    await api(`/productos/${id}/receta`, { metodo: 'PUT', cuerpo: { ingredientes: receta } });
    toast('Producto y receta guardados');
    seleccionado = id;
    await cargarCatalogo();
    pintarEditor({ ...datos, id_producto: id });
  } catch (e) { toast(e.message, 'error'); }
}

//PROVEEDORES 
async function cargarProveedores() {
  proveedores = await api('/proveedores');
  $('#cuerpo-proveedores').innerHTML = proveedores.length ? proveedores.map((p) => `<tr>
    <td class="nombre">${esc(p.nombre)}</td><td>${esc(p.telefono || '—')}</td><td>${esc(p.correo || '—')}</td>
    <td><button class="boton boton--chico" data-prov="${p.id_proveedor}">Editar</button></td></tr>`).join('')
    : '<tr><td colspan="4" class="vacio">Aún no hay proveedores registrados.</td></tr>';
}

async function guardarProveedor(id) {
  const p = id ? proveedores.find((x) => x.id_proveedor === id) : {};
  const d = await pedirDatos({ titulo: id ? 'Editar proveedor' : 'Nuevo proveedor', boton: 'Guardar', campos: [
    { id: 'nombre', label: 'Nombre', requerido: true, valor: p.nombre, ancho: 'completo' },
    { id: 'telefono', label: 'Teléfono', tipo: 'tel', valor: p.telefono },
    { id: 'correo', label: 'Correo', tipo: 'email', valor: p.correo }
  ] });
  if (!d) return;
  try {
    await api(id ? '/proveedores/' + id : '/proveedores', { metodo: id ? 'PUT' : 'POST', cuerpo: d });
    toast('Proveedor guardado');
    await cargarProveedores();
  } catch (e) { toast(e.message, 'error'); }
}

//ARRANQUE 
document.addEventListener('DOMContentLoaded', async () => {
  if (!(await iniciarPagina())) return;
  try { await Promise.all([cargarProveedores(), cargarCategorias(), cargarExistencias()]); }
  catch (e) { return toast(e.message, 'error'); }

  const abrir = { existencias: cargarExistencias, movimientos: cargarMovimientos, recetas: cargarCatalogo, proveedores: cargarProveedores };
  $$('.pestana').forEach((b) => (b.onclick = () => {
    $$('.pestana').forEach((x) => x.classList.toggle('pestana--activa', x === b));
    $$('.panel').forEach((p) => (p.hidden = p.id !== 'panel-' + b.dataset.panel));
    abrir[b.dataset.panel]().catch((e) => toast(e.message, 'error'));
  }));

  let espera;
  const retrasar = (fn) => () => { clearTimeout(espera); espera = setTimeout(() => fn().catch((e) => toast(e.message, 'error')), 250); };
  $('#buscar').addEventListener('input', retrasar(cargarExistencias));
  $('#filtro-categoria').addEventListener('change', cargarExistencias);
  $('#mov-buscar').addEventListener('input', retrasar(cargarMovimientos));
  $('#mov-tipo').addEventListener('change', cargarMovimientos);

  $('#cuerpo-existencias').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.mov) registrarMovimiento(b.dataset.mov, Number(b.dataset.codigo));
    if (b.dataset.editar) guardarIngrediente(Number(b.dataset.editar));
  });
  $('#nuevo-ingrediente').onclick = () => guardarIngrediente(null);

  $('#lista-productos').addEventListener('click', (e) => { const b = e.target.closest('[data-producto]'); if (b) abrirProducto(Number(b.dataset.producto)); });
  $('#nuevo-producto').onclick = () => abrirProducto(null);

  $('#nuevo-proveedor').onclick = () => guardarProveedor(null);
  $('#cuerpo-proveedores').addEventListener('click', (e) => { const b = e.target.closest('[data-prov]'); if (b) guardarProveedor(Number(b.dataset.prov)); });
});
