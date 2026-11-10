// Pantalla de caja: abrir turno, entradas y salidas de efectivo, ventas del
// turno (reimprimir o cancelar) y cierre con arqueo.

import { h, add, fill, money, plural, call, btn, toast, openModal, confirmDialog, clock, dayAndClock, METHOD } from '../ui.js';
import { numpadDialog, textDialog } from '../keyboard.js';

let ctx = null;
let root = null;

export async function mount(container, context) {
  ctx = context;
  root = container;
  root.className = 'screen-page';
  await render();
}

async function render() {
  const state = await call('cash.current');
  ctx.refreshStatus();
  if (state) await renderOpen(state);
  else await renderClosed();
}

// ---------- Caja cerrada ----------
async function renderClosed() {
  const history = await call('cash.history');
  fill(root,
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'La caja está cerrada'), h('p', null, 'Ábrela con el efectivo que hay en el cajón para empezar a cobrar.')),
      btn('Abrir caja', openSession, 'btn-primary btn-big')),
    h('h2', null, 'Cortes anteriores'),
    history.length
      ? h('div', { class: 'table' },
          h('div', { class: 'tr th cols-5' }, h('span', null, 'Cierre'), h('span', null, 'Fondo'), h('span', null, 'Esperado'), h('span', null, 'Contado'), h('span', null, 'Diferencia')),
          history.map((s) => {
            const diff = s.counted_cash - s.expected_cash;
            return h('div', { class: 'tr cols-5' },
              h('span', null, dayAndClock(s.closed_at)),
              h('span', { class: 'num' }, money(s.opening_cash)),
              h('span', { class: 'num' }, money(s.expected_cash)),
              h('span', { class: 'num' }, money(s.counted_cash)),
              h('span', { class: `num ${diff < 0 ? 'bad' : diff > 0 ? 'warn' : ''}` }, money(diff)));
          }))
      : h('p', { class: 'muted' }, 'Aquí aparecerán los cortes cuando cierres la caja por primera vez.')
  );
}

async function openSession() {
  const openingCash = await numpadDialog({
    title: 'Fondo inicial',
    hint: 'Cuenta el efectivo que hay en el cajón antes de la primera venta.',
    initial: 0,
    okText: 'Abrir caja',
  });
  if (openingCash === null) return;
  await call('cash.open', { openingCash });
  toast('Caja abierta');
  await render();
}

// ---------- Caja abierta ----------
async function renderOpen(state) {
  const orders = await call('orders.listSession');
  const line = (label, value, cls = '') => h('div', { class: `sum-row ${cls}` }, h('span', null, label), h('strong', null, value));

  fill(root,
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'Caja abierta'), h('p', null, `Desde las ${clock(state.session.opened_at)} del ${dayAndClock(state.session.opened_at).slice(0, 5)}`)),
      btn('Cerrar caja', () => closeSession(state), 'btn-primary btn-big')),

    h('div', { class: 'two-col' },
      h('section', { class: 'card' },
        h('h2', null, 'Efectivo en el cajón'),
        line('Fondo inicial', money(state.session.opening_cash)),
        line('Ventas en efectivo', money(state.sales.cash)),
        line('Entradas', money(state.cashIn)),
        line('Salidas', money(-state.cashOut)),
        line('Debe haber', money(state.expectedCash), 'sum-total')),
      h('section', { class: 'card' },
        h('h2', null, 'Ventas del turno'),
        line('Efectivo', money(state.sales.cash)),
        line('Tarjeta', money(state.sales.card)),
        line('Transferencia', money(state.sales.transfer)),
        line(`Total de ${plural(state.orderCount, 'cuenta', 'cuentas')}`, money(state.salesTotal), 'sum-total'),
        state.cancelledCount > 0 && h('p', { class: 'muted' }, `${plural(state.cancelledCount, 'venta cancelada', 'ventas canceladas')} en este turno.`))),

    h('div', { class: 'button-row' },
      btn('Entrada de efectivo', () => movement('in')),
      btn('Salida de efectivo', () => movement('out')),
      btn('Abrir cajón', async () => {
        await call('printer.drawer');
        toast('Cajón abierto');
      })),

    state.movements.length > 0 && [
      h('h2', null, 'Entradas y salidas'),
      h('div', { class: 'table' },
        state.movements.map((m) =>
          h('div', { class: 'tr cols-move' },
            h('span', null, clock(m.created_at)),
            h('span', null, m.reason),
            h('span', { class: `num ${m.type === 'out' ? 'bad' : ''}` }, money(m.type === 'in' ? m.amount : -m.amount))))),
    ],

    h('h2', null, 'Ventas cobradas'),
    orders.length
      ? h('div', { class: 'table' },
          orders.map((order) =>
            h('button', { class: `tr cols-5 tr-tap ${order.status === 'cancelled' ? 'struck' : ''}`, type: 'button', onClick: () => orderActions(order) },
              h('span', null, `Folio ${order.id}`),
              h('span', null, clock(order.paid_at)),
              h('span', null, order.label || 'Sin nombre'),
              h('span', null, order.status === 'cancelled' ? 'Cancelada' : METHOD[order.payment_method]),
              h('span', { class: 'num' }, money(order.total)))))
      : h('p', { class: 'muted' }, 'Todavía no hay ventas en este turno.')
  );
}

async function movement(type) {
  const isIn = type === 'in';
  const amount = await numpadDialog({ title: isIn ? 'Entrada de efectivo' : 'Salida de efectivo', hint: isIn ? 'Dinero que entra al cajón sin ser una venta.' : 'Dinero que sale del cajón: proveedor, compras, retiro.' });
  if (!amount) return;
  const reason = await textDialog({ title: isIn ? '¿De dónde viene?' : '¿Para qué es?', placeholder: isIn ? 'Cambio, préstamo…' : 'Tortillas, gas, retiro…', maxLength: 40 });
  if (!reason) return;
  await call('cash.addMovement', { type, amount, reason });
  toast(isIn ? 'Entrada registrada' : 'Salida registrada');
  await render();
}

function orderActions(order) {
  openModal((box, close) => {
    const cancelled = order.status === 'cancelled';
    add(box, 
      h('h2', null, `Folio ${order.id}`),
      h('p', { class: 'modal-text' },
        `${order.label || 'Sin nombre'}, ${money(order.total)}, ${cancelled ? 'cancelada' : METHOD[order.payment_method].toLowerCase()}, ${clock(order.paid_at)}`),
      h('div', { class: 'modal-actions' },
        !cancelled && btn('Cancelar venta', async () => {
          const ok = await confirmDialog({
            title: `¿Cancelar la venta del folio ${order.id}?`,
            message: order.payment_method === 'cash'
              ? `Regresa ${money(order.total)} al cliente: el corte ya no contará ese efectivo.`
              : 'La venta deja de contar en el corte y en los reportes.',
            okText: 'Cancelar venta',
            cancelText: 'Volver',
            danger: true,
          });
          if (!ok) return;
          await call('orders.cancel', { id: order.id });
          toast('Venta cancelada');
          close();
          await render();
        }, 'btn-danger'),
        h('span', { class: 'spacer' }),
        btn('Reimprimir', async () => {
          await call('orders.reprint', { id: order.id });
          toast('Ticket enviado a la impresora');
        }),
        btn('Cerrar', close, 'btn-primary'))
    );
  }, { size: 'md' });
}

async function closeSession(state) {
  const countedCash = await numpadDialog({
    title: 'Efectivo contado',
    hint: `Cuenta todo el efectivo del cajón. Debe haber ${money(state.expectedCash)}.`,
    okText: 'Continuar',
  });
  if (countedCash === null) return;

  const diff = countedCash - state.expectedCash;
  const result = diff === 0 ? 'La caja cuadra.' : diff < 0 ? `Faltan ${money(-diff)}.` : `Sobran ${money(diff)}.`;
  const pending = state.openOrders > 0 ? ` ${state.openOrders === 1 ? 'Queda 1 cuenta abierta' : `Quedan ${state.openOrders} cuentas abiertas`} sin cobrar.` : '';
  const ok = await confirmDialog({
    title: '¿Cerrar la caja?',
    message: `Contaste ${money(countedCash)}. ${result}${pending}`,
    okText: 'Cerrar caja',
    cancelText: 'Volver',
  });
  if (!ok) return;

  const { printError } = await call('cash.close', { countedCash });
  toast(printError ? `Caja cerrada. El corte no se imprimió: ${printError}` : 'Caja cerrada', printError ? 'error' : 'info');
  await render();
}
