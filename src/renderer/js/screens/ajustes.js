// Pantalla de ajustes: datos del negocio, impresora y salida del programa.

import { h, add, fill, call, btn, toast, openModal, confirmDialog, setScreenMargin } from '../ui.js';
import { renderFields } from '../form.js';
import { tapLog, onTap } from '../tap.js';
import { restartToUpdate } from '../update.js';

const TARGET_HELP = {
  share: 'Nombre con el que se compartió la impresora, por ejemplo \\\\localhost\\TICKETS',
  tcp: 'Dirección de la impresora en la red, por ejemplo 192.168.1.50:9100',
  port: 'Puerto al que está conectada, por ejemplo COM3 o LPT1',
};

const POINTER = { mouse: 'ratón', touch: 'táctil', pen: 'lápiz' };

// Muestra que recibe la app en cada toque (ver tap.js). Sirve para saber si
// un toque perdido se quedo en el driver de la pantalla o llego raro a la app.
function touchTest() {
  openModal((box, close) => {
    const rows = h('div', { class: 'table tap-log' });
    const paint = () => fill(rows,
      h('div', { class: 'tr th cols-tap' },
        ['Tipo', 'Bajó en', 'Subió en', 'Movió', 'Duró', 'Resultado', 'Clic'].map((title) => h('span', null, title))),
      tapLog.length
        ? tapLog.map((tap) =>
            h('div', { class: `tr cols-tap ${tap.result === 'toque' ? '' : 'low'}` },
              h('span', null, POINTER[tap.type] || tap.type),
              h('span', null, tap.from),
              h('span', null, tap.to),
              h('span', { class: 'num' }, `${tap.moved} px`),
              h('span', { class: 'num' }, `${tap.lasted} ms`),
              h('span', null, tap.result),
              h('span', null, tap.native ? 'sí' : 'no')))
        : h('div', { class: 'tr' }, 'Todavía no hay toques.'));
    const stop = onTap(paint);

    const targets = [1, 2, 3, 4, 5, 6].map((n) => {
      let count = 0;
      const counter = h('small', null, 'sin tocar');
      return h('button', {
        class: 'choice',
        type: 'button',
        onClick: () => {
          count += 1;
          counter.textContent = count === 1 ? '1 vez' : `${count} veces`;
        },
      }, String(n), counter);
    });

    add(box,
      h('h2', null, 'Probar pantalla táctil'),
      h('p', { class: 'modal-text' }, 'Toca los números como al vender. Cada toque debe sumar una vez. Si alguno no suma o suma doble, tómale foto a la tabla.'),
      h('div', { class: 'choices tap-test', style: { '--cols': '6' } }, targets),
      rows,
      h('div', { class: 'modal-actions' }, btn('Cerrar', () => {
        stop();
        close();
      }, 'btn-primary')));
    paint();
  }, { size: 'xl' });
}

export async function mount(container) {
  container.className = 'screen-page';
  const [values, info] = await Promise.all([call('settings.get'), call('app.info')]);
  // Los interruptores se guardan como '1' / '0'; el formulario usa true / false.
  values.printOnPay = values.printOnPay === '1';
  values.drawerOnCash = values.drawerOnCash === '1';

  const save = async (key, value) => {
    await call('settings.set', { [key]: value });
  };

  const business = h('div', { class: 'fields' });
  renderFields(business, [
    { key: 'businessName', label: 'Nombre del negocio', type: 'text', maxLength: 32 },
    { key: 'ticketHeader', label: 'Encabezado del ticket', hint: 'Dirección y teléfono', type: 'text', maxLength: 120, emptyText: 'Sin encabezado', placeholder: 'Calle Hidalgo 123, Centro. Tel. 866 000 0000' },
    { key: 'ticketFooter', label: 'Mensaje al final del ticket', type: 'text', maxLength: 120, emptyText: 'Sin mensaje' },
    { key: 'tableCount', label: 'Número de mesas', type: 'int' },
  ], values, save);

  const screen = h('div', { class: 'fields' });
  renderFields(screen, [
    { key: 'screenMargin', label: 'Margen de pantalla', hint: 'Aleja todo del marco si el touch falla en las orillas', type: 'choice', columns: 4, options: [
      { value: '0', label: 'Sin margen' },
      { value: '24', label: 'Chico' },
      { value: '48', label: 'Mediano' },
      { value: '72', label: 'Grande' },
    ] },
  ], values, async (key, value) => {
    await save(key, value);
    setScreenMargin(value); // se ve al instante
  });

  const printer = h('div', { class: 'fields' });
  const targetHelp = h('p', { class: 'muted' });
  const paintHelp = () => {
    targetHelp.textContent = values.printerMode === 'file'
      ? `Sin impresora: cada ticket se guarda como archivo de texto junto a la base de datos.`
      : TARGET_HELP[values.printerMode];
  };
  renderFields(printer, [
    { key: 'printerMode', label: 'Conexión de la impresora', type: 'choice', columns: 2, options: [
      { value: 'file', label: 'Sin impresora (archivo)' },
      { value: 'share', label: 'USB, compartida en Windows' },
      { value: 'tcp', label: 'Red (Ethernet o wifi)' },
      { value: 'port', label: 'Puerto COM o LPT' },
    ] },
    { key: 'printerTarget', label: 'Destino', type: 'text', maxLength: 80, visible: (v) => v.printerMode !== 'file' },
    { key: 'printerColumns', label: 'Ancho del papel', type: 'choice', columns: 3, options: [
      { value: '32', label: '58 mm (32 letras)' },
      { value: '42', label: '80 mm (42 letras)' },
      { value: '48', label: '80 mm (48 letras)' },
    ] },
    { key: 'printerEncoding', label: 'Acentos y eñes', hint: 'Cambia si salen símbolos raros', type: 'choice', columns: 3, options: [
      { value: 'cp850', label: 'CP850' },
      { value: 'cp1252', label: 'Windows-1252' },
      { value: 'ascii', label: 'Sin acentos' },
    ] },
    { key: 'printOnPay', label: 'Imprimir ticket al cobrar', type: 'toggle' },
    { key: 'drawerOnCash', label: 'Abrir cajón al cobrar en efectivo', type: 'toggle' },
  ], values, async (key, value) => {
    await save(key, value);
    paintHelp();
  });
  paintHelp();

  // Estado del actualizador. Se vuelve a dibujar despues de cada busqueda.
  const updateBox = h('div');
  const paintUpdate = (status) => fill(updateBox,
    h('p', { class: 'muted' }, status.message),
    status.state === 'ready' && status.notes && h('p', { class: 'muted' }, `Novedades: ${status.notes}`),
    h('div', { class: 'button-row' },
      btn('Buscar actualización', async () => {
        paintUpdate({ state: 'checking', message: 'Buscando actualización…' });
        paintUpdate(await call('update.check'));
      }),
      status.state === 'ready' && btn(`Reiniciar para instalar la ${status.version}`, () => restartToUpdate(status.version), 'btn-primary')));
  paintUpdate(await call('update.status'));

  add(container, 
    h('header', { class: 'page-head' }, h('div', null, h('h1', null, 'Ajustes'), h('p', null, 'Cada cambio se guarda al momento.'))),
    h('h2', null, 'Negocio'),
    business,
    h('h2', null, 'Impresora y cajón'),
    printer,
    targetHelp,
    h('div', { class: 'button-row' },
      btn('Imprimir ticket de prueba', async () => {
        const where = await call('printer.test');
        toast(values.printerMode === 'file' ? `Ticket guardado en ${where}` : 'Ticket de prueba enviado');
      }),
      btn('Abrir cajón', async () => {
        await call('printer.drawer');
        toast('Señal enviada al cajón');
      })),
    h('h2', null, 'Pantalla'),
    screen,
    h('div', { class: 'button-row' }, btn('Probar pantalla táctil', touchTest)),
    h('h2', null, 'Actualizaciones'),
    h('p', null, info.source === 'update'
      ? `Versión ${info.version}, instalada por actualización automática.`
      : `Versión ${info.version}.`),
    updateBox,
    h('h2', null, 'Programa'),
    h('p', { class: 'muted' }, `Electron ${info.electron}. Los datos están en ${info.dbFile}`),
    h('div', { class: 'button-row' },
      btn('Salir del programa', async () => {
        const ok = await confirmDialog({ title: '¿Salir del programa?', message: 'Las cuentas abiertas y la caja se conservan.', okText: 'Salir' });
        if (ok) await call('app.quit');
      }, 'btn-danger'))
  );
}
