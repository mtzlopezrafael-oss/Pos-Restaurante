// Pantalla de inventario: existencias de los productos que lo llevan.

import { h, fill, call, btn, toast } from '../ui.js';
import { numpadDialog } from '../keyboard.js';

let ctx = null;
let root = null;

export async function mount(container, context) {
  ctx = context;
  root = container;
  root.className = 'screen-page';
  paint(await call('inventory.list'));
}

function paint(items) {
  const low = items.filter((item) => item.low).length;
  fill(root,
    h('header', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Inventario'),
        h('p', null, items.length
          ? (low ? (low === 1 ? '1 producto está en su mínimo o por debajo.' : `${low} productos están en su mínimo o por debajo.`) : 'Todo está por encima de su mínimo.')
          : 'Ningún producto lleva inventario todavía.'))),
    items.length
      ? h('div', { class: 'table' },
          h('div', { class: 'tr th cols-stock' }, h('span', null, 'Producto'), h('span', null, 'Hay'), h('span', null, 'Mínimo'), h('span')),
          items.map((item) =>
            h('div', { class: `tr cols-stock ${item.low ? 'low' : ''}` },
              h('span', { class: 'with-dot', style: { '--cat': item.category_color } }, h('strong', null, item.name), h('small', null, item.category_name)),
              h('span', { class: `num big ${item.stock <= 0 ? 'bad' : ''}` }, String(item.stock)),
              h('span', { class: 'num' }, String(item.stock_min)),
              h('span', { class: 'row-actions' },
                btn('Entrada', () => adjust(item, 'purchase')),
                btn('Merma', () => adjust(item, 'waste')),
                btn('Contar', () => adjust(item, 'count'))))))
      : h('div', { class: 'empty' },
          h('p', null, 'Activa "Lleva inventario" en los productos que se cuentan por pieza, como refrescos o agua embotellada.'),
          btn('Ir a Productos', () => ctx.go('productos'), 'btn-primary'))
  );
}

const DIALOG = {
  purchase: (item) => ({ title: `Entrada de ${item.name}`, hint: 'Piezas que llegaron.', done: 'Entrada registrada' }),
  waste: (item) => ({ title: `Merma de ${item.name}`, hint: 'Piezas que se perdieron, rompieron o caducaron.', done: 'Merma registrada' }),
  count: (item) => ({ title: `Conteo de ${item.name}`, hint: `El sistema dice ${item.stock}. Escribe cuántas hay en realidad.`, done: 'Inventario corregido' }),
};

async function adjust(item, type) {
  const text = DIALOG[type](item);
  const qty = await numpadDialog({ title: text.title, hint: text.hint, mode: 'int', initial: type === 'count' ? Math.max(0, item.stock) : null });
  if (qty === null || (type !== 'count' && qty === 0)) return;
  const items = await call('inventory.adjust', { productId: item.id, type, qty });
  toast(text.done);
  paint(items);
}
