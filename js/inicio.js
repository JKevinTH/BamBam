// Página de inicio: saludo y notificaciones calculadas con los datos reales
const contenedor = document.getElementById("avisos");
let avisos = [];

// "Marcar como leídas" se recuerda en este navegador (los avisos se recalculan solos)
const leidas = () => JSON.parse(localStorage.getItem("avisosLeidos") || "[]");
const clave = (a) => a.titulo + "|" + a.texto;

function pintarAvisos() {
  const ocultas = leidas();
  const visibles = avisos.filter((a) => !ocultas.includes(clave(a)));
  if (!visibles.length) {
    contenedor.innerHTML = '<p class="tarjeta__info">No tienes avisos nuevos.</p>';
    return;
  }
  contenedor.innerHTML = visibles.map((a) => `
    <article class="tarjeta ${a.tipo === "urgente" ? "-estado_urgente" : "-estado_ok"}">
        <span class="tarjeta_tmp">${esc(a.etiqueta)}</span>
        <div class="semi-tarjeta">
            <h3 class="tarjeta__nombre">${esc(a.titulo)}</h3>
            <p class="tarjeta__info">${esc(a.texto)}</p>
        </div>
        <a href="${esc(a.enlace)}" class="btn-tarjeta">${esc(a.boton)}</a>
    </article>`).join("");
}

document.addEventListener("DOMContentLoaded", async () => {
  if (!(await iniciarPagina())) return;
  document.getElementById("nombre-usuario").textContent = Sesion.usuario.nombre;
  try {
    avisos = await api("/avisos");
    pintarAvisos();
  } catch (e) {
    contenedor.innerHTML = `<p class="tarjeta__info">${esc(e.message)}</p>`;
  }
});

document.getElementById("marcar-leidas").addEventListener("click", () => {
  localStorage.setItem("avisosLeidos", JSON.stringify(avisos.map(clave)));
  pintarAvisos();
});
