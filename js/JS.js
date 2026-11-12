const formulario = document.querySelector("form");
const mensaje = document.getElementById("error");


if (Sesion.token) location.href = "index.html";

formulario.addEventListener("submit", async function (event) {
  event.preventDefault();
  mensaje.hidden = true;
  const boton = formulario.querySelector('input[type="submit"]');
  boton.disabled = true;

  try {
    const datos = await api("/login", {
      metodo: "POST",
      cuerpo: {
        usuario: formulario.usuario.value,
        contrasena: formulario.contrasena.value
      }
    });
    Sesion.iniciar(datos.token, datos.usuario);
    window.location.href = "index.html";
  } catch (error) {
    mensaje.textContent = error.message;
    mensaje.hidden = false;
    boton.disabled = false;
  }
});
