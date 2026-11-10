// Pantalla de venta: menu a la izquierda, cuenta (ticket) a la derecha.

import { h, add, fill, money, plural, call, safe, btn, toast, openModal, confirmDialog, choiceDialog, clock, METHOD } from '../ui.js';
import { amountState, numpadKeys, physicalToNumpad, textDialog } from '../keyboard.js';
import { ordered } from '../order.js';

// La cuenta en curso vive fuera de mount(): asi no se pierde si a media
// captura alguien entra a otra pantalla y regresa.
//   id    null = cuenta nueva; numero = cuenta abierta guardada en la base
//   dirty hay cambios sin guardar
const ticket = { id: null, label: '', items: [], dirty: false };

let categories = [];
let products = [];
let activeCategory = null;
let tableCount = 10;
let openCount = 0;
let ctx = null;
let els = {};

const total = () => ticket.items.reduce((sum, item) => sum + item.price * item.qty, 0);

// Para avisar antes de reiniciar el programa: esta cuenta solo vive en memoria.
export const hasUnsavedTicket = () => ticket.dirty && ticket.items.length > 0;

function resetTicket() {
  ticket.id = null;
  ticket.label = '';
  ticket.items = [];
  ticket.dirty = false;
}

export async function mount(container, context) {
  ctx = context;
  const [cats, prods, settings, open] = await Promise.all([
    call('catalog.listCategories'),
    call('catalog.listProducts'),
    call('settings.get'),
    call('orders.listOpen'),
  ]);
  categories = cats;
  products = prods;
  tableCount = Number(settings.tableCount);
  openCount = open.length;
  if (!categories.some((c) => c.id === activeCategory)) activeCategory = categories.length ? categories[0].id : null;

  els = {
    tabs: h('div', { class: 'tabs' }),
    grid: h('div', { class: 'product-grid' }),
    ticket: h('aside', { class: 'ticket' }),
  };
  container.className = 'screen-venta';
  add(container, h('section', { class: 'menu' }, els.tabs, els.grid), els.ticket);
  renderTabs();
  renderGrid();
  renderTicket();
}

// ---------- Menu ----------
function renderTabs() {
  els.tabs.replaceChildren(
    ...categories.map((category) =>
      h('button', {
        class: `tab ${category.id === activeCategory ? 'active' : ''}`,
        type: 'button',
        style: { '--cat': category.color },
        onClick: () => {
          activeCategory = category.id;
          renderTabs();
          renderGrid();
        },
      }, category.name))
  );
}

function renderGrid() {
  const visible = ordered(products.filter((p) => p.category_id === activeCategory));
  if (!categories.length || !visible.length) {
    els.grid.replaceChildren(
      h('div', { class: 'empty' },
        h('p', null, categories.length ? 'Esta categoría no tiene productos.' : 'Todavía no hay productos en el menú.'),
        btn('Agregar productos', () => ctx.go('productos'), 'btn-primary'))
    );
    return;
  }
  els.grid.replaceChildren(
    ...visible.map((product) => {
      // Lo que queda: inventario propio, compartido (vaso, tapa...) o el menor de los dos.
      const counts = [];
      if (product.track_stock) counts.push(product.stock);
      if (product.shared_stock != null) counts.push(product.shared_stock);
      const left = counts.length ? Math.min(...counts) : null;
      const out = left !== null && left <= 0;
      return h('button', {
        class: `product ${out ? 'out' : ''}`,
        type: 'button',
        style: { '--cat': product.category_color },
        onClick: () => addProduct(product),
      },
        h('span', { class: 'product-name' }, product.name),
        h('span', { class: 'product-meta' },
          h('span', { class: 'product-price' }, money(product.price)),
          left !== null ? h('span', { class: 'product-stock' }, out ? 'Agotado' : `Hay ${left}`) : null));
    })
  );
}

function addProduct(product) {
  // Si ya esta en la cuenta (y sin nota), solo sube la cantidad.
  const existing = ticket.items.find((item) => item.productId === product.id && !item.note);
  if (existing) existing.qty += 1;
  else ticket.items.push({ productId: product.id, name: product.name, price: product.price, qty: 1, note: '' });
  ticket.dirty = true;
  renderTicket();
  const list = els.ticket.querySelector('.ticket-lines');
  if (list) list.scrollTop = list.scrollHeight;
}

// ---------- Cuenta ----------
function renderTicket() {
  const sum = total();
  const empty = ticket.items.length === 0;

  fill(els.ticket,
    h('header', { class: 'ticket-head' },
      h('button', { class: 'ticket-label', type: 'button', onClick: safe(changeLabel) },
        h('small', null, ticket.id ? 'Cuenta abierta' : 'Cuenta nueva'),
        h('strong', null, ticket.label || 'Elegir mesa')),
      h('button', { class: 'btn open-orders', type: 'button', onClick: safe(showOpenOrders) },
        'Cuentas', h('span', { class: `count ${openCount ? 'some' : ''}` }, String(openCount)))),

    empty
      ? h('div', { class: 'ticket-lines ticket-empty' }, h('p', null, 'Toca un producto para agregarlo a la cuenta.'))
      : h('div', { class: 'ticket-lines' },
          ticket.items.map((item) =>
            h('button', { class: 'line', type: 'button', onClick: () => editItem(item) },
              h('span', { class: 'line-qty' }, String(item.qty)),
              h('span', { class: 'line-name' }, item.name, item.note && h('small', null, item.note)),
              h('span', { class: 'line-amount' }, money(item.price * item.qty))))),

    h('div', { class: 'tear' }),
    h('footer', { class: 'ticket-foot' },
      h('div', { class: 'ticket-total' }, h('span', null, 'Total'), h('strong', null, money(sum))),
      h('div', { class: 'ticket-actions' },
        btn(ticket.id ? 'Cancelar cuenta' : 'Vaciar', discard, 'btn-quiet', { disabled: empty && !ticket.id }),
        btn('Guardar cuenta', saveOpen, '', { disabled: empty })),
      btn(empty ? 'Cobrar' : `Cobrar ${money(sum)}`, pay, 'btn-pay btn-big', { disabled: empty }))
  );
}

async function pickLabel() {
  const options = [{ value: 'Para llevar', label: 'Para llevar' }];
  for (let n = 1; n <= tableCount; n++) options.push({ value: `Mesa ${n}`, label: `Mesa ${n}` });
  options.push({ value: '__other', label: 'Otro nombre' });
  const choice = await choiceDialog({ title: '¿De quién es la cuenta?', options, columns: 4, current: ticket.label, size: 'lg' });
  if (choice !== '__other') return choice;
  return textDialog({ title: 'Nombre de la cuenta', initial: '', maxLength: 30, placeholder: 'Nombre del cliente' });
}

async function changeLabel() {
  const label = await pickLabel();
  if (!label) return;
  ticket.label = label;
  ticket.dirty = true;
  renderTicket();
}

// Ventana para un renglon: cantidad, nota y quitar.
function editItem(item) {
  openModal((box, close) => {
    const qty = h('strong', { class: 'stepper-value' });
    const note = h('span', { class: 'field-value' });
    const paint = () => {
      qty.textContent = String(item.qty);
      note.textContent = item.note || 'Sin nota';
      note.classList.toggle('unset', !item.note);
    };
    const done = () => {
      close();
      renderTicket();
    };
    const step = (delta) => () => {
      item.qty = Math.min(999, Math.max(1, item.qty + delta));
      ticket.dirty = true;
      paint();
    };
    add(box, 
      h('h2', null, item.name),
      h('p', { class: 'modal-text' }, `${money(item.price)} cada uno`),
      h('div', { class: 'stepper' },
        h('button', { class: 'key', type: 'button', onClick: step(-1) }, '−'),
        qty,
        h('button', { class: 'key', type: 'button', onClick: step(1) }, '+')),
      h('div', { class: 'fields' },
        h('button', {
          class: 'field',
          type: 'button',
          onClick: safe(async () => {
            const text = await textDialog({ title: `Nota para ${item.name}`, initial: item.note, maxLength: 60, placeholder: 'Sin cebolla, para llevar…' });
            if (text === null) return;
            item.note = text;
            ticket.dirty = true;
            paint();
          }),
        }, h('span', { class: 'field-label' }, 'Nota para cocina'), note)),
      h('div', { class: 'modal-actions' },
        btn('Quitar de la cuenta', () => {
          ticket.items.splice(ticket.items.indexOf(item), 1);
          ticket.dirty = true;
          done();
        }, 'btn-danger'),
        h('span', { class: 'spacer' }),
        btn('Listo', done, 'btn-primary'))
    );
    paint();
  }, { size: 'sm' });
}

async function discard() {
  if (ticket.id) {
    const ok = await confirmDialog({
      title: `¿Cancelar la cuenta de ${ticket.label}?`,
      message: 'Se quita de las cuentas abiertas y no se cobra.',
      okText: 'Cancelar cuenta',
      cancelText: 'Volver',
      danger: true,
    });
    if (!ok) return;
    await call('orders.cancel', { id: ticket.id });
    openCount = Math.max(0, openCount - 1);
    toast('Cuenta cancelada');
  } else if (ticket.items.length > 2) {
    const ok = await confirmDialog({ title: '¿Vaciar la cuenta?', okText: 'Vaciar', cancelText: 'Volver', danger: true });
    if (!ok) return;
  }
  resetTicket();
  renderTicket();
}

const payload = () => ({
  id: ticket.id,
  label: ticket.label,
  items: ticket.items.map(({ productId, qty, note }) => ({ productId, qty, note })),
});

async function saveOpen() {
  if (!ticket.label) {
    const label = await pickLabel();
    if (!label) return;
    ticket.label = label;
  }
  const wasNew = !ticket.id;
  const saved = await call('orders.save', payload());
  if (wasNew) openCount += 1;
  toast(`Cuenta guardada: ${saved.label}`);
  resetTicket();
  renderTicket();
}

async function showOpenOrders() {
  if (ticket.dirty && ticket.items.length) {
    const ok = await confirmDialog({
      title: 'La cuenta actual tiene cambios sin guardar',
      message: 'Si abres otra cuenta, esos cambios se pierden.',
      okText: 'Descartar cambios',
      cancelText: 'Seguir en esta cuenta',
      danger: true,
    });
    if (!ok) return;
  }
  const orders = await call('orders.listOpen');
  openCount = orders.length;
  renderTicket();

  openModal((box, close) => {
    const load = (order) => safe(async () => {
      const full = await call('orders.get', { id: order.id });
      ticket.id = full.id;
      ticket.label = full.label;
      ticket.dirty = false;
      ticket.items = full.items.map((item) => {
        // Usa el precio vigente del producto, igual que hara el cobro.
        const current = products.find((p) => p.id === item.product_id);
        return { productId: item.product_id, name: item.name, price: current ? current.price : item.price, qty: item.qty, note: item.note };
      });
      close();
      renderTicket();
    });
    add(box, 
      h('h2', null, 'Cuentas abiertas'),
      orders.length
        ? h('div', { class: 'choices', style: { '--cols': '3' } },
            orders.map((order) =>
              h('button', { class: 'choice open-order', type: 'button', onClick: load(order) },
                h('strong', null, order.label),
                h('span', null, money(order.total)),
                h('small', null, `${plural(order.item_count, 'producto', 'productos')}, desde las ${clock(order.created_at)}`))))
        : h('p', { class: 'modal-text' }, 'No hay cuentas abiertas. Para dejar una, captura los productos y toca "Guardar cuenta".'),
      h('div', { class: 'modal-actions' },
        btn('Cuenta nueva', () => {
          resetTicket();
          close();
          renderTicket();
        }),
        h('span', { class: 'spacer' }),
        btn('Cerrar', close, 'btn-primary'))
    );
  }, { size: 'lg' });
}

// ---------- Cobro ----------
// Billetes sugeridos: los siguientes montos "redondos" arriba del total.
function quickAmounts(sum) {
  const pesos = [50, 100, 200, 500, 1000];
  const options = new Set();
  for (const bill of pesos) {
    const next = Math.ceil(sum / (bill * 100)) * bill * 100;
    if (next > sum) options.add(next);
  }
  return [...options].sort((a, b) => a - b).slice(0, 4);
}

// Regresa { method, cashReceived } o null si se cancela.
function payDialog(sum) {
  return new Promise((resolve) => {
    let method = 'cash';
    const received = amountState('money', sum);
    let finish;

    const receivedEl = h('strong');
    const changeEl = h('strong');
    const changeRow = h('div', { class: 'pay-row' }, h('span', null, 'Cambio'), changeEl);
    const cashSide = h('div', { class: 'pay-cash' });
    const methods = h('div', { class: 'pay-methods' });
    const confirm = btn(`Cobrar ${money(sum)}`, () => finish({ method, cashReceived: method === 'cash' ? received.value() : null }), 'btn-pay btn-big');

    const paint = () => {
      methods.replaceChildren(
        ...Object.keys(METHOD).map((key) =>
          h('button', {
            class: `choice ${key === method ? 'active' : ''}`,
            type: 'button',
            onClick: () => {
              method = key;
              paint();
            },
          }, METHOD[key]))
      );
      const isCash = method === 'cash';
      cashSide.classList.toggle('hidden', !isCash);
      const missing = sum - received.value();
      receivedEl.textContent = received.display();
      changeRow.classList.toggle('short', isCash && missing > 0);
      changeRow.firstChild.textContent = missing > 0 ? 'Falta' : 'Cambio';
      changeEl.textContent = money(Math.abs(missing));
      confirm.disabled = isCash && missing > 0;
    };
    const press = (key) => {
      received.press(key);
      paint();
    };

    add(cashSide, 
      h('div', { class: 'quick' },
        btn('Exacto', () => {
          received.set(sum);
          paint();
        }),
        quickAmounts(sum).map((amount) => btn(money(amount).replace('.00', ''), () => {
          received.set(amount);
          paint();
        }))),
      numpadKeys(press)
    );

    const close = openModal(
      (box) => {
        add(box, 
          h('h2', null, ticket.label ? `Cobrar ${ticket.label}` : 'Cobrar'),
          h('div', { class: 'pay' },
            h('div', { class: 'pay-info' },
              h('div', { class: 'pay-row pay-total' }, h('span', null, 'Total'), h('strong', null, money(sum))),
              methods,
              h('div', { class: 'pay-row' }, h('span', null, 'Recibido'), receivedEl),
              changeRow),
            cashSide),
          h('div', { class: 'modal-actions' }, btn('Volver', () => finish(null)), h('span', { class: 'spacer' }), confirm)
        );
      },
      {
        size: 'lg',
        onKey: (event) => {
          const key = method === 'cash' ? physicalToNumpad(event) : null;
          if (key) press(key);
          else if (event.key === 'Escape') finish(null);
        },
      }
    );
    finish = (value) => {
      close();
      resolve(value);
    };
    paint();
  });
}

async function pay() {
  if (!(await call('cash.current'))) {
    const go = await confirmDialog({
      title: 'La caja está cerrada',
      message: 'Para cobrar hay que abrir la caja con su fondo inicial.',
      okText: 'Ir a Caja',
      cancelText: 'Volver',
    });
    if (go) ctx.go('caja');
    return;
  }
  const choice = await payDialog(total());
  if (!choice) return;

  const wasOpen = Boolean(ticket.id);
  const { order, printError } = await call('orders.pay', { ...payload(), ...choice });
  if (wasOpen) openCount = Math.max(0, openCount - 1);
  resetTicket();
  products = await call('catalog.listProducts'); // el inventario cambio
  renderGrid();
  renderTicket();
  showPaid(order, printError);
}

function showPaid(order, printError) {
  openModal((box, close) => {
    const cash = order.payment_method === 'cash';
    add(box, 
      h('h2', null, `Venta cobrada, folio ${order.id}`),
      h('div', { class: 'paid' },
        h('span', null, cash ? 'Cambio' : `Pago con ${METHOD[order.payment_method].toLowerCase()}`),
        h('strong', null, money(cash ? order.change_given : order.total))),
      printError && h('p', { class: 'notice' }, `La venta quedó guardada, pero el ticket no salió. ${printError}`),
      h('div', { class: 'modal-actions' },
        btn('Imprimir otra vez', async () => {
          await call('orders.reprint', { id: order.id });
          toast('Ticket enviado a la impresora');
        }),
        h('span', { class: 'spacer' }),
        btn('Siguiente cuenta', close, 'btn-primary'))
    );
  }, { size: 'sm', onKey: () => {} });
}
