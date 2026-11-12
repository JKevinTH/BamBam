
const aMinutos = (hms) => { const [h, m] = hms.split(':').map(Number); return h * 60 + m; };

function horasTrabajadas(e, s) {
  if (!e || !s) return '—';
  let m = aMinutos(s) - aMinutos(e);
  if (m < 0) m += 24 * 60;            // turno que cruza la medianoche
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

async function cargar() {
  const filas = await api('/personal/hoy');
  let presentes = 0, sin = 0, retardos = 0;

  $('#personal').innerHTML = filas.map((f) => {
    let estado, boton;
    if (!f.entrada) { estado = '<span class="estado estado--neutro">Sin registrar</span>'; sin++;
      boton = `<button class="boton boton--chico boton--principal" data-entrada="${esc(f.clave)}">Registrar entrada</button>`; }
    else if (f.salida) { estado = '<span class="estado estado--neutro">Turno cerrado</span>'; boton = ''; }
    else { presentes++;
      estado = f.retardo ? '<span class="estado estado--aviso">Retardo</span>' : '<span class="estado estado--ok">Presente</span>';
      boton = `<button class="boton boton--chico" data-salida="${esc(f.clave)}">Registrar salida</button>`; }
    if (f.retardo) retardos++;
    return `<tr>
      <td class="empleado">${esc(cap(f.nombre))} ${esc(cap(f.apellido))}</td><td>${esc(cap(f.rol))}</td>
      <td class="turno">${esc(cap(f.horario))}<small>desde ${horaCorta(f.inicio_turno)}</small></td>
      <td>${horaCorta(f.entrada)}</td><td>${horaCorta(f.salida)}</td><td>${horasTrabajadas(f.entrada, f.salida)}</td>
      <td>${estado}</td><td>${boton}</td></tr>`;
  }).join('') || '<tr><td colspan="8" class="vacio">No hay empleados registrados.</td></tr>';

  $('#r-presentes').textContent = presentes;
  $('#r-sin').textContent = sin;
  $('#r-retardos').textContent = retardos;
}

document.addEventListener('DOMContentLoaded', async () => {
  if (!(await iniciarPagina())) return;
  $('#fecha-hoy').textContent = 'Entradas y salidas del turno · ' + new Date().toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long' });
  try { await cargar(); } catch (e) { return toast(e.message, 'error'); }

  $('#personal').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    const tipo = b.dataset.entrada ? 'entrada' : 'salida';
    try {
      await api('/personal/' + tipo, { metodo: 'POST', cuerpo: { clave: b.dataset.entrada || b.dataset.salida } });
      toast(tipo === 'entrada' ? 'Entrada registrada' : 'Salida registrada');
      await cargar();
    } catch (err) { toast(err.message, 'error'); }
  });
});
