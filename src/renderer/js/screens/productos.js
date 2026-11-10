// Pantalla de productos: categorias a la izquierda, productos a la derecha.

import { h, fill, money, call, btn, toast, confirmDialog } from '../ui.js';
import { formDialog } from '../form.js';
import { ordered, orderMode, setOrderMode } from '../order.js';

const COLORS = [
  { value: '#C2410C', label: 'Naranja' },
  { value: '#B4236B', label: 'Rosa' },
  { value: '#1B4DB3', label: 'Azul' },
  { value: '#6D3FB5', label: 'Morado' },
  { value: '#18794E', label: 'Verde' },
  { value: '#A16207', label: 'Mostaza' },
  { value: '#0E7490', label: 'Turquesa' },
  { value: '#475569', label: 'Gris' },
].map((c) => ({ ...c, color: c.value }));

let root = null;
let categories = [];
let products = [];
let selected = null;

export async function mount(container) {
  root = container;
  root.className = 'screen-page';
  await reload();
}

async function reload() {
  [categories, products] = await Promise.all([call('catalog.listCategories'), call('catalog.listProducts')]);
  if (!categories.some((c) => c.id === selected)) selected = categories.length ? categories[0].id : null;
  paint();
}

function paint() {
  const category = categories.find((c) => c.id === selected);
  const list = ordered(products.filter((p) => p.category_id === selected));
  const similar = orderMode() === 'similar';

  fill(root,
    h('header', { class: 'page-head' },
      h('div', null, h('h1', null, 'Productos'), h('p', null, 'Toca una categoría para ver su menú, o un producto para cambiarlo.')),
      btn('Nueva categoría', () => editCategory(null))),
    h('div', { class: 'split' },
      h('div', { class: 'split-side' },
        categories.map((c) =>
          h('button', {
            class: `side-item ${c.id === selected ? 'active' : ''}`,
            type: 'button',
            style: { '--cat': c.color },
            onClick: () => {
              selected = c.id;
              paint();
            },
          }, c.name, h('small', null, String(products.filter((p) => p.category_id === c.id).length))))),
      category
        ? h('div', { class: 'split-main' },
            h('div', { class: 'button-row' },
              btn('Nuevo producto', () => editProduct(null), 'btn-primary'),
              btn(`Editar "${category.name}"`, () => editCategory(category)),
              // Solo cambia el orden en pantalla (aqui y en Venta); no modifica productos.
              btn(similar ? 'Volver a orden alfabético' : 'Juntar parecidos', () => {
                setOrderMode(similar ? 'alpha' : 'similar');
                toast(similar ? 'Orden alfabético, aquí y en Venta' : 'Los parecidos quedan juntos, aquí y en Venta');
                paint();
              })),
            list.length
              ? h('div', { class: 'table' },
                  list.map((p) =>
                    h('button', { class: 'tr cols-prod tr-tap', type: 'button', onClick: () => editProduct(p) },
                      h('strong', null, p.name),
                      h('span', { class: 'muted' }, [p.track_stock ? `Inventario: ${p.stock}` : '', p.shared_names ? `Usa: ${p.shared_names}` : ''].filter(Boolean).join(', ')),
                      h('span', { class: 'num' }, money(p.price)))))
              : h('p', { class: 'muted' }, 'Esta categoría todavía no tiene productos.'))
        : h('div', { class: 'split-main empty' }, h('p', null, 'Crea la primera categoría del menú: Comidas, Bebidas, Postres…'))
    )
  );
}

async function editCategory(category) {
  const result = await formDialog({
    title: category ? 'Editar categoría' : 'Nueva categoría',
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', maxLength: 24, placeholder: 'Bebidas' },
      { key: 'color', label: 'Color de sus botones', type: 'choice', options: COLORS, columns: 4 },
    ],
    values: category ? { name: category.name, color: category.color } : { name: '', color: COLORS[0].value },
    extra: category ? [{ label: 'Eliminar', action: 'remove', variant: 'btn-danger' }] : [],
  });
  if (!result) return;

  if (result.action === 'remove') {
    const ok = await confirmDialog({ title: `¿Eliminar la categoría ${category.name}?`, okText: 'Eliminar', danger: true });
    if (!ok) return;
    await call('catalog.removeCategory', { id: category.id });
    toast('Categoría eliminada');
  } else {
    const saved = await call('catalog.saveCategory', { id: category && category.id, ...result.values });
    selected = saved.id;
    toast('Categoría guardada');
  }
  await reload();
}

async function editProduct(product) {
  // Inventarios compartidos que existen y los que este producto ya usa.
  const { items } = await call('inventory.list');
  const linked = product ? await call('inventory.productItems', { productId: product.id }) : [];
  const result = await formDialog({
    title: product ? 'Editar producto' : 'Nuevo producto',
    fields: [
      { key: 'name', label: 'Nombre', type: 'text', maxLength: 40, placeholder: 'Enchiladas verdes' },
      { key: 'price', label: 'Precio', type: 'money' },
      { key: 'categoryId', label: 'Categoría', type: 'choice', options: categories.map((c) => ({ value: c.id, label: c.name, color: c.color })), columns: 3 },
      { key: 'trackStock', label: 'Lleva inventario propio', hint: 'Para lo que se cuenta por pieza', type: 'toggle' },
      { key: 'stockMin', label: 'Avisar cuando queden', type: 'int', visible: (v) => v.trackStock },
      {
        key: 'itemIds',
        label: 'Inventario compartido',
        hint: 'Vaso, tapa o envase que descuenta al venderse',
        type: 'multi',
        groupLabel: 'Inventarios compartidos',
        options: items.map((item) => ({ value: item.id, label: item.name })),
        emptyText: 'Ninguno',
        visible: () => items.length > 0,
      },
    ],
    values: product
      ? { name: product.name, price: product.price, categoryId: product.category_id, trackStock: Boolean(product.track_stock), stockMin: product.stock_min, itemIds: linked }
      : { name: '', price: 0, categoryId: selected, trackStock: false, stockMin: 0, itemIds: [] },
    extra: product ? [{ label: 'Eliminar', action: 'remove', variant: 'btn-danger' }] : [],
  });
  if (!result) return;

  if (result.action === 'remove') {
    const ok = await confirmDialog({
      title: `¿Eliminar ${product.name}?`,
      message: 'Deja de aparecer en el menú. Las ventas anteriores no cambian.',
      okText: 'Eliminar',
      danger: true,
    });
    if (!ok) return;
    await call('catalog.removeProduct', { id: product.id });
    toast('Producto eliminado');
  } else {
    const { itemIds, ...fields } = result.values;
    const saved = await call('catalog.saveProduct', { id: product && product.id, ...fields });
    if (items.length > 0) await call('inventory.setProductItems', { productId: saved.id, itemIds });
    toast('Producto guardado');
  }
  await reload();
}
