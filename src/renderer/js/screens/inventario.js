// Pantalla de inventario. Dos listas:
//   - Compartido entre productos: un inventario aparte (vaso, tapa, envase) al
//     que se vinculan varios productos; vender cualquiera descuenta de ahi.
//   - Por producto: los productos que se cuentan a si mismos.

import { h, fill, call, btn, toast, plural, confirmDialog, multiSelectDialog } from '../ui.js';
import { numpadDialog, textDialog } from '../keyboard.js';
import { formDialog } from '../form.js';
import { ordered } from '../order.js';

let root = null;

export async function mount(container) {
  root = container;
  root.className = 'screen-page';
  paint(await call('inventory.list'));
}

function paint({ items, products }) {
  const low = items.filter((i) => i.low).length + products.filter((p) => p.low).length;
  const total = items.length + products.length;
  const adjustButtons = (target, kind) => [
    btn('Entrada', () => adjust(target, kind, 'purchase')),
    btn('Merma', () => adjust(target, kind, 'waste')),
    btn('Contar', () => adjust(target, kind, 'count')),
  ];

  fill(root,
    h('header', { class: 'page-head' },
      h('div', null,
        h('h1', null, 'Inventario'),
        h('p', null, total === 0
          ? 'Todavía no se lleva inventario de nada.'
          : low ? `${low === 1 ? '1 inventario está' : `${low} inventarios están`} en su mínimo o por debajo.` : 'Todo está por encima de su mínimo.')),
      btn('Nuevo inventario compartido', createItem, 'btn-primary')),

    h('h2', null, 'Compartido entre productos'),
    items.length
      ? h('div', { class: 'table' },
          h('div', { class: 'tr th cols-item' }, h('span', null, 'Inventario'), h('span', null, 'Hay'), h('span', null, 'Mínimo'), h('span')),
          items.map((item) =>
            h('div', { class: `tr cols-item ${item.low ? 'low' : ''}` },
              h('button', { class: 'cell-btn', type: 'button', onClick: () => editItem(item) },
                h('strong', null, item.name),
                h('small', null, item.product_count ? `Lo ${item.product_count === 1 ? 'usa' : 'usan'} ${plural(item.product_count, 'producto', 'productos')}` : 'Sin productos vinculados')),
              h('span', { class: `num big ${item.stock <= 0 ? 'bad' : ''}` }, String(item.stock)),
              h('span', { class: 'num' }, String(item.stock_min)),
              h('span', { class: 'row-actions' }, adjustButtons(item, 'item'), btn('Productos', () => linkProducts(item))))))
      : h('p', { class: 'muted' }, 'Sirve para lo que usan varios productos, como un vaso de medio litro: lo creas, dices cuántos hay y eliges qué productos lo usan. Al vender cualquiera de ellos se descuenta de aquí.'),

    products.length > 0 && [
      h('h2', null, 'Por producto'),
      h('div', { class: 'table' },
        h('div', { class: 'tr th cols-stock' }, h('span', null, 'Producto'), h('span', null, 'Hay'), h('span', null, 'Mínimo'), h('span')),
        products.map((product) =>
          h('div', { class: `tr cols-stock ${product.low ? 'low' : ''}` },
            h('span', { class: 'with-dot', style: { '--cat': product.category_color } }, h('strong', null, product.name), h('small', null, product.category_name)),
            h('span', { class: `num big ${product.stock <= 0 ? 'bad' : ''}` }, String(product.stock)),
            h('span', { class: 'num' }, String(product.stock_min)),
            h('span', { class: 'row-actions' }, adjustButtons(product, 'product'))))),
    ],
    products.length === 0 && h('p', { class: 'muted' }, 'Para contar un producto por pieza (un refresco, un agua embotellada), activa "Lleva inventario propio" al editarlo en Productos.')
  );
}

// ---------- Entradas, mermas y conteos (sirve para los dos tipos) ----------
const TEXT = {
  purchase: (name) => ({ title: `Entrada de ${name}`, hint: 'Piezas que llegaron.', done: 'Entrada registrada' }),
  waste: (name) => ({ title: `Merma de ${name}`, hint: 'Piezas que se perdieron, rompieron o caducaron.', done: 'Merma registrada' }),
  count: (name, stock) => ({ title: `Conteo de ${name}`, hint: `El sistema dice ${stock}. Escribe cuántas hay en realidad.`, done: 'Inventario corregido' }),
};

async function adjust(target, kind, type) {
  const text = TEXT[type](target.name, target.stock);
  const qty = await numpadDialog({ title: text.title, hint: text.hint, mode: 'int', initial: type === 'count' ? Math.max(0, target.stock) : null });
  if (qty === null || (type !== 'count' && qty === 0)) return;
  const lists = kind === 'item'
    ? await call('inventory.adjustItem', { itemId: target.id, type, qty })
    : await call('inventory.adjust', { productId: target.id, type, qty });
  toast(text.done);
  paint(lists);
}

// ---------- Inventario compartido ----------
// Alta guiada: nombre, cuantos hay y que productos lo usan. Cada paso se
// puede saltar; el inventario queda creado desde el primero.
async function createItem() {
  const name = await textDialog({ title: 'Nombre del inventario', placeholder: 'Vaso 1/2 litro', maxLength: 40 });
  if (!name) return;
  let lists = await call('inventory.saveItem', { name, stockMin: 0 });
  paint(lists);
  // El recien creado es el de id mas alto.
  const item = lists.items.reduce((newest, i) => (i.id > newest.id ? i : newest));

  const count = await numpadDialog({ title: `¿Cuántos hay de ${item.name}?`, hint: 'Cuenta lo que tienes ahora. Lo puedes corregir después con "Contar".', mode: 'int', okText: 'Continuar' });
  if (count) {
    lists = await call('inventory.adjustItem', { itemId: item.id, type: 'count', qty: count });
    paint(lists);
  }
  await linkProducts(item);
}

async function editItem(item) {
  const result = await formDialog({
    title: 'Editar inventario',
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', maxLength: 40 },
      { key: 'stockMin', label: 'Avisar cuando queden', type: 'int' },
    ],
    values: { name: item.name, stockMin: item.stock_min },
    extra: [{ label: 'Eliminar', action: 'remove', variant: 'btn-danger' }],
  });
  if (!result) return;
  if (result.action === 'remove') {
    const ok = await confirmDialog({
      title: `¿Eliminar el inventario ${item.name}?`,
      message: 'Sus productos se siguen vendiendo, pero ya no descuentan de ningún inventario.',
      okText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    paint(await call('inventory.removeItem', { id: item.id }));
    toast('Inventario eliminado');
  } else {
    paint(await call('inventory.saveItem', { id: item.id, ...result.values }));
    toast('Inventario guardado');
  }
}

// Elegir, de todo el menu, que productos descuentan de este inventario.
async function linkProducts(item) {
  const [categories, products, current] = await Promise.all([
    call('catalog.listCategories'),
    call('catalog.listProducts'),
    call('inventory.itemProducts', { itemId: item.id }),
  ]);
  if (!products.length) {
    toast('Todavía no hay productos en el menú.');
    return;
  }
  const chosen = await multiSelectDialog({
    title: `¿Qué productos usan ${item.name}?`,
    hint: 'Cada venta de un producto marcado descuenta 1 de este inventario.',
    groups: categories.map((category) => ({
      label: category.name,
      color: category.color,
      options: ordered(products.filter((p) => p.category_id === category.id)).map((p) => ({ value: p.id, label: p.name })),
    })),
    selected: current,
  });
  if (!chosen) return;
  paint(await call('inventory.setItemProducts', { itemId: item.id, productIds: chosen }));
  toast(chosen.length ? `${item.name}: ${plural(chosen.length, 'producto vinculado', 'productos vinculados')}` : `${item.name} quedó sin productos`);
}
