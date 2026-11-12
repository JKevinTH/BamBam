class Miheader extends HTMLElement {
    connectedCallback() {
        
        const pagina = location.pathname.split('/').pop() || 'index.html';

        
        const enlace = (href, texto) =>
            `<a href="${href}" class="${pagina === href ? 'activo' : ''}">${texto}</a>`;

        this.innerHTML = `
        <nav class="sidebar">
            <h2>Pizzeria BAMBAM</h2>
            ${enlace('index.html', 'Inicio')}
            ${enlace('ventas.html', 'Ventas')}
            ${enlace('corte_de_caja.html', 'Corte de caja')}
            ${enlace('inventario.html', 'Inventario')}
            ${enlace('personal.html', 'Personal')}

            <div class="menu_inferior">
                <hr>
                <a href="login.html" class="cerrar-sesion">Cerrar sesión</a>
            </div>
        </nav>
        `;

        this.querySelector('.cerrar-sesion').addEventListener('click', () => sessionStorage.clear());
    }
}
customElements.define('mi-header', Miheader);