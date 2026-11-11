// Arranque de la interfaz: barra lateral y cambio entre pantallas.
// Cada pantalla es un modulo con una funcion mount(contenedor, contexto).

import './tap.js'; // toques confiables: debe cargarse antes que las pantallas
import { h, fill, icon, call, toast, clock, setScreenMargin } from './ui.js';
import { restartToUpdate } from './update.js';
import * as venta from './screens/venta.js';
import * as caja from './screens/caja.js';
import * as inventario from './screens/inventario.js';
import * as productos from './screens/productos.js';
import * as reportes from './screens/reportes.js';
import * as ajustes from './screens/ajustes.js';

const SCREENS = [
  { id: 'venta', label: 'Venta', module: venta },
  { id: 'caja', label: 'Caja', module: caja },
  { id: 'inventario', label: 'Inventario', module: inventario },
  { id: 'productos', label: 'Productos', module: productos },
  { id: 'reportes', label: 'Reportes', module: reportes },
  { id: 'ajustes', label: 'Ajustes', module: ajustes },
];

const nav = document.getElementById('nav');
const screen = document.getElementById('screen');
const time = h('div', { class: 'nav-clock' });
let current = null;
let cashOpen = false;
let updateReady = null; // { version } cuando hay una actualizacion descargada

function paintNav() {
  fill(nav,
    SCREENS.map((s) =>
      h('button', {
        class: `nav-item ${s.id === current ? 'active' : ''} ${s.id === 'caja' && !cashOpen ? 'alert' : ''}`,
        type: 'button',
        onClick: () => go(s.id),
      }, icon(s.id), h('span', null, s.label))),
    h('div', { class: 'nav-bottom' },
      // Solo aparece cuando ya se descargo una version nueva.
      updateReady && h('button', { class: 'nav-update', type: 'button', onClick: () => restartToUpdate(updateReady.version) },
        'Actualizar', h('small', null, updateReady.version)),
      time)
  );
}

// Lo que cada pantalla recibe para moverse y avisar cambios.
const context = {
  go,
  // Actualiza el punto rojo de "Caja" (cerrada) en la barra lateral.
  async refreshStatus() {
    cashOpen = Boolean(await call('cash.current'));
    paintNav();
  },
};

async function go(id) {
  const target = SCREENS.find((s) => s.id === id);
  current = id;
  paintNav();
  // Cada visita estrena contenedor: si una pantalla anterior seguia cargando,
  // termina de dibujarse en un elemento que ya no esta en la pagina.
  const view = h('div');
  screen.replaceChildren(view);
  try {
    await target.module.mount(view, context);
    return true;
  } catch (error) {
    toast(error.message, 'error');
    return false;
  }
}

// El toque largo abre el menu contextual del navegador: aqui no se usa.
window.addEventListener('contextmenu', (event) => event.preventDefault());

const tick = () => {
  time.textContent = clock();
};
tick();
setInterval(tick, 15000);

// El proceso principal busca y descarga actualizaciones por su cuenta; aqui
// solo se le pregunta cada tanto si ya hay una lista para instalar.
async function pollUpdate() {
  try {
    const status = await call('update.status');
    const next = status.state === 'ready' ? status : null;
    if ((next && next.version) === (updateReady && updateReady.version)) return;
    updateReady = next;
    paintNav();
    if (next) toast(`La versión ${next.version} está lista. Toca "Actualizar" cuando no haya clientes.`);
  } catch (error) {
    // sin novedad
  }
}

call('settings.get')
  .then((settings) => setScreenMargin(settings.screenMargin)) // antes de dibujar, para que no brinque
  .then(() => context.refreshStatus())
  .then(() => go('venta'))
  .then(async (loaded) => {
    // Si la primera pantalla se dibujo, se avisa al lanzador que esta version
    // arranco bien (ver boot.js). Si no se dibujo, no se avisa: el lanzador
    // regresa solo a la version anterior.
    if (!loaded) return;
    await call('app.ready');
    const info = await call('app.info');
    if (info.rolledBackFrom) toast(`La versión ${info.rolledBackFrom} no arrancó bien. Se regresó a la ${info.version}.`, 'error');
    else if (info.updatedFrom) toast(`Programa actualizado a la versión ${info.version}`);
    pollUpdate();
    setInterval(pollUpdate, 15000);
  })
  .catch((error) => toast(error.message, 'error'));
