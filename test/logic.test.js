// Pruebas de la logica de negocio con una base de datos en memoria.
// Se corren con: npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { openDatabase } = require('../src/main/db');
const { createServices } = require('../src/main/services');
const { EscPos, encode } = require('../src/main/printer/escpos');
const ticket = require('../src/main/printer/ticket');

// Cada prueba arranca con una base nueva (con el menu de ejemplo).
function setup() {
  const db = openDatabase(':memory:');
  const services = createServices(db);
  const products = services.catalog.listProducts();
  const find = (name) => products.find((p) => p.name === name);
  return { db, ...services, find };
}

const today = () => {
  const d = new Date();
  const two = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
};

test('no se puede cobrar con la caja cerrada', () => {
  const { orders, find } = setup();
  assert.throws(
    () => orders.pay({ items: [{ productId: find('Taco').id, qty: 1 }], method: 'cash', cashReceived: 5000 }),
    /caja está cerrada/
  );
});

test('venta en efectivo: total, cambio e inventario', () => {
  const { orders, cash, find, catalog } = setup();
  cash.open({ openingCash: 50000 });
  const refresco = find('Refresco 600 ml'); // $25.00, lleva inventario, stock 24
  const order = orders.pay({
    label: 'Mesa 1',
    items: [
      { productId: find('Taco').id, qty: 3 }, // 3 x $20.00
      { productId: refresco.id, qty: 2, note: 'sin hielo' }, // 2 x $25.00
    ],
    method: 'cash',
    cashReceived: 20000,
  });
  assert.equal(order.status, 'paid');
  assert.equal(order.total, 11000);
  assert.equal(order.change_given, 9000);
  assert.equal(order.items[1].note, 'sin hielo');
  assert.equal(catalog.listProducts().find((p) => p.id === refresco.id).stock, 22);
});

test('el precio sale de la base de datos, no de lo que mande la pantalla', () => {
  const { orders, cash, find } = setup();
  cash.open({ openingCash: 0 });
  const order = orders.pay({
    items: [{ productId: find('Taco').id, qty: 1, price: 1, name: 'Gratis' }],
    method: 'card',
  });
  assert.equal(order.total, 2000);
  assert.equal(order.items[0].name, 'Taco');
});

test('efectivo insuficiente no deja la venta a medias', () => {
  const { orders, cash, find, db } = setup();
  cash.open({ openingCash: 0 });
  assert.throws(
    () => orders.pay({ items: [{ productId: find('Flan').id, qty: 1 }], method: 'cash', cashReceived: 1000 }),
    /no cubre el total/
  );
  // La transaccion se deshizo completa: no quedo ninguna cuenta.
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n, 0);
});

test('cuenta abierta: guardar, modificar y cobrar despues', () => {
  const { orders, cash, find } = setup();
  assert.throws(() => orders.save({ label: '', items: [{ productId: find('Sope').id, qty: 1 }] }), /nombre/);

  const saved = orders.save({ label: 'Mesa 4', items: [{ productId: find('Sope').id, qty: 2 }] });
  assert.equal(saved.status, 'open');
  assert.equal(orders.listOpen().length, 1);
  assert.equal(orders.listOpen()[0].item_count, 2);

  cash.open({ openingCash: 0 });
  const paid = orders.pay({
    id: saved.id,
    label: 'Mesa 4',
    items: [
      { productId: find('Sope').id, qty: 2 },
      { productId: find('Agua fresca').id, qty: 1 },
    ],
    method: 'transfer',
  });
  assert.equal(paid.id, saved.id);
  assert.equal(paid.total, 2 * 2800 + 2000);
  assert.equal(orders.listOpen().length, 0);
  assert.throws(() => orders.save({ id: saved.id, label: 'Mesa 4', items: paid.items }), /cobrada o cancelada/);
});

test('cancelar una venta cobrada regresa el inventario y la saca del corte', () => {
  const { orders, cash, find, catalog } = setup();
  cash.open({ openingCash: 10000 });
  const agua = find('Agua embotellada');
  const order = orders.pay({ items: [{ productId: agua.id, qty: 5 }], method: 'cash', cashReceived: 10000 });
  assert.equal(cash.current().expectedCash, 10000 + 7500);

  orders.cancel(order.id);
  assert.equal(catalog.listProducts().find((p) => p.id === agua.id).stock, agua.stock);
  assert.equal(cash.current().expectedCash, 10000);
  assert.equal(cash.current().cancelledCount, 1);
  assert.throws(() => orders.cancel(order.id), /ya estaba cancelada/);
});

test('corte de caja: esperado = fondo + efectivo + entradas - salidas', () => {
  const { orders, cash, find } = setup();
  cash.open({ openingCash: 50000 });
  assert.throws(() => cash.open({ openingCash: 0 }), /ya está abierta/);

  orders.pay({ items: [{ productId: find('Enchiladas').id, qty: 2 }], method: 'cash', cashReceived: 20000 }); // 17000
  orders.pay({ items: [{ productId: find('Flan').id, qty: 1 }], method: 'card' }); // 3000, no entra al cajon
  cash.addMovement({ type: 'out', amount: 12000, reason: 'Tortillas' });
  cash.addMovement({ type: 'in', amount: 5000, reason: 'Cambio' });

  const before = cash.current();
  assert.equal(before.sales.cash, 17000);
  assert.equal(before.sales.card, 3000);
  assert.equal(before.salesTotal, 20000);
  assert.equal(before.expectedCash, 50000 + 17000 + 5000 - 12000);

  const closed = cash.close({ countedCash: 59500 });
  assert.equal(closed.session.expected_cash, 60000);
  assert.equal(closed.session.counted_cash, 59500);
  assert.equal(cash.current(), null);
  assert.equal(cash.history().length, 1);
});

test('inventario: entrada, merma y conteo', () => {
  const { inventory, find } = setup();
  const refresco = find('Refresco 600 ml');
  const stockOf = () => inventory.list().products.find((p) => p.id === refresco.id).stock;
  inventory.adjust({ productId: refresco.id, type: 'purchase', qty: 12 });
  assert.equal(stockOf(), 36);
  inventory.adjust({ productId: refresco.id, type: 'waste', qty: 1 });
  assert.equal(stockOf(), 35);
  inventory.adjust({ productId: refresco.id, type: 'count', qty: 4 });
  assert.equal(stockOf(), 4);
  assert.equal(inventory.list().products[0].id, refresco.id); // stock bajo aparece primero
  assert.equal(inventory.movements({ productId: refresco.id }).length, 3);
  assert.throws(() => inventory.adjust({ productId: find('Taco').id, type: 'purchase', qty: 1 }), /no lleva inventario/);
});

test('inventario compartido: varios productos descuentan del mismo', () => {
  const { inventory, orders, cash, catalog, find, db } = setup();
  const stock = (name) => inventory.list().items.find((i) => i.name === name).stock;
  const shared = (name) => catalog.listProducts().find((p) => p.name === name);

  inventory.saveItem({ name: 'Vaso 1/2 litro', stockMin: 10 });
  inventory.saveItem({ name: 'Tapa', stockMin: 0 });
  const [vaso, tapa] = ['Vaso 1/2 litro', 'Tapa'].map((name) => inventory.list().items.find((i) => i.name === name));
  inventory.adjustItem({ itemId: vaso.id, type: 'purchase', qty: 50 });
  inventory.adjustItem({ itemId: tapa.id, type: 'purchase', qty: 20 });

  // Dos "sabores" usan el mismo vaso; uno ademas lleva tapa.
  const fresca = find('Agua fresca');
  const cafe = find('Café de olla');
  inventory.setItemProducts({ itemId: vaso.id, productIds: [fresca.id, cafe.id] });
  inventory.setProductItems({ productId: cafe.id, itemIds: [vaso.id, tapa.id] });
  assert.equal(inventory.list().items.find((i) => i.id === vaso.id).product_count, 2);
  assert.deepEqual(inventory.productItems({ productId: cafe.id }).sort(), [vaso.id, tapa.id].sort());
  assert.equal(shared('Agua fresca').shared_stock, 50);
  assert.equal(shared('Café de olla').shared_stock, 20); // manda el que menos alcanza: la tapa
  assert.equal(shared('Café de olla').shared_names, 'Vaso 1/2 litro, Tapa');
  assert.equal(shared('Taco').shared_stock, null);

  cash.open({ openingCash: 0 });
  const order = orders.pay({
    items: [{ productId: fresca.id, qty: 3 }, { productId: cafe.id, qty: 2 }, { productId: find('Taco').id, qty: 1 }],
    method: 'card',
  });
  assert.equal(stock('Vaso 1/2 litro'), 45); // 3 + 2 vasos
  assert.equal(stock('Tapa'), 18); // solo el cafe lleva tapa

  orders.cancel(order.id); // cancelar regresa lo descontado
  assert.equal(stock('Vaso 1/2 litro'), 50);
  assert.equal(stock('Tapa'), 20);

  // Merma, conteo y desvincular.
  inventory.adjustItem({ itemId: vaso.id, type: 'waste', qty: 5 });
  inventory.adjustItem({ itemId: vaso.id, type: 'count', qty: 8 });
  assert.equal(stock('Vaso 1/2 litro'), 8);
  assert.equal(inventory.list().items[0].name, 'Vaso 1/2 litro'); // bajo su minimo: aparece primero
  inventory.setItemProducts({ itemId: vaso.id, productIds: [fresca.id] });
  assert.deepEqual(inventory.itemProducts({ itemId: vaso.id }), [fresca.id]);

  // Eliminar el inventario: sus productos siguen vendiendose y ya no descuentan.
  inventory.removeItem({ id: vaso.id });
  assert.equal(shared('Agua fresca').shared_stock, null);
  orders.pay({ items: [{ productId: fresca.id, qty: 1 }], method: 'card' });
  assert.equal(db.prepare('SELECT stock FROM stock_items WHERE id = ?').get(vaso.id).stock, 8);
  assert.throws(() => inventory.adjustItem({ itemId: vaso.id, type: 'purchase', qty: 1 }), /ya no existe/);
  assert.throws(() => inventory.saveItem({ name: '   ' }), /Falta/);
});

test('reporte de ventas del dia', () => {
  const { orders, cash, reports, find } = setup();
  cash.open({ openingCash: 0 });
  orders.pay({ items: [{ productId: find('Taco').id, qty: 4 }], method: 'cash', cashReceived: 8000 });
  orders.pay({ items: [{ productId: find('Taco').id, qty: 1 }, { productId: find('Flan').id, qty: 1 }], method: 'card' });
  const report = reports.sales({ from: today(), to: today() });
  assert.equal(report.count, 2);
  assert.equal(report.total, 8000 + 5000);
  assert.equal(report.average, 6500);
  assert.equal(report.byDay.length, 1);
  assert.deepEqual(report.topProducts[0], { name: 'Taco', qty: 5, total: 10000 });
  assert.throws(() => reports.sales({ from: 'ayer', to: today() }), /rango/);
});

test('catalogo y ajustes validan lo que reciben', () => {
  const { catalog, settings } = setup();
  const category = catalog.saveCategory({ name: 'Desayunos', color: '#18794E' });
  assert.throws(() => catalog.saveProduct({ categoryId: category.id, name: '  ', price: 100 }), /Falta/);
  assert.throws(() => catalog.saveProduct({ categoryId: category.id, name: 'Huevos', price: 45.5 }), /precio/i);
  const product = catalog.saveProduct({ categoryId: category.id, name: 'Huevos al gusto', price: 6500 });
  assert.throws(() => catalog.removeCategory(category.id), /tiene productos/);
  catalog.removeProduct(product.id);
  catalog.removeCategory(category.id);

  assert.equal(settings.get().printerMode, 'file');
  assert.throws(() => settings.set({ printerMode: 'bluetooth' }), /no es válido/);
  assert.equal(settings.set({ businessName: 'Fonda Lupita', tableCount: 12 }).tableCount, '12');
});

test('ESC/POS: acentos en CP850, cajon y corte', () => {
  assert.deepEqual([...encode('ñandú ¿Ñ?', 'cp850')], [0xa4, 0x61, 0x6e, 0x64, 0xa3, 0x20, 0xa8, 0xa5, 0x3f]);
  assert.equal(encode('Café ñ', 'ascii').toString('latin1'), 'Cafe n');

  const { bytes, plain } = new EscPos({ columns: 32 }).pair('2 x Taco', '$40.00').kickDrawer().cut().build();
  assert.equal(plain, '2 x Taco                  $40.00\n');
  assert.ok(bytes.includes(Buffer.from([0x1b, 0x70, 0, 25, 250]))); // pulso del cajon
  assert.ok(bytes.includes(Buffer.from([0x1d, 0x56, 66, 0]))); // corte
});

test('juntar parecidos: agrupa por palabra compartida y ordena por tamaño', async () => {
  // similar.js es un modulo del renderer (ES module); se carga con import().
  const { arrangeBySimilarity, analyze } = await import('../src/renderer/js/similar.js');
  const names = [
    'Yoghurt natural ch', 'Licuado de fresa', 'Especial yoghurt gde', 'Agua de fresa',
    'Yoghurt especial med', 'Fresas con crema', 'Yoghurt natural gde', 'Agua de horchata',
    'Yoghurt especial ch', 'Licuado de plátano', 'Yoghurt natural med', 'Café',
  ];
  const result = arrangeBySimilarity(names.map((name) => ({ name }))).map((p) => p.name);
  assert.deepEqual(result, [
    'Agua de fresa', 'Agua de horchata',
    'Café',
    'Fresas con crema',
    'Licuado de fresa', 'Licuado de plátano',
    'Yoghurt especial ch', 'Yoghurt especial med', 'Especial yoghurt gde',
    'Yoghurt natural ch', 'Yoghurt natural med', 'Yoghurt natural gde',
  ]);

  // No pierde ni duplica productos, y con uno solo o ninguno no truena.
  assert.equal(new Set(result).size, names.length);
  assert.deepEqual(arrangeBySimilarity([]), []);
  assert.deepEqual(arrangeBySimilarity([{ name: 'Flan' }]), [{ name: 'Flan' }]);

  // Tamaños con numero: medio litro (500) < 600 ml < 1 lt < 1.5 lt.
  const aguas = arrangeBySimilarity(['Agua 1.5 lt', 'Agua 1 lt', 'Agua 600ml', 'Agua 1/2 lt'].map((name) => ({ name })));
  assert.deepEqual(aguas.map((p) => p.name), ['Agua 1/2 lt', 'Agua 600ml', 'Agua 1 lt', 'Agua 1.5 lt']);
  assert.deepEqual(analyze('Fresas con Crema GDE').words, ['fresa', 'crema']);
});

test('lanzador: elige la actualizacion solo si es mas nueva, esta intacta y no ha fallado', () => {
  // original-fs: el fs de Electron trata cualquier *.asar como carpeta y aqui
  // se escriben archivos .asar de mentira.
  const fs = require('original-fs');
  const os = require('os');
  const path = require('path');
  const u = require('../src/main/update-state');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-updates-'));
  const put = (version, content = `codigo ${version}`) => {
    fs.writeFileSync(path.join(dir, `code-${version}.asar`), content);
    const state = u.readState(dir);
    state.current = { version, file: `code-${version}.asar`, sha256: u.hashOf(Buffer.from(content)) };
    u.writeState(dir, state);
  };

  assert.equal(u.newer('0.1.10', '0.1.9'), true); // se compara por numero, no por texto
  assert.equal(u.newer('0.1.3', '0.1.3'), false);
  assert.equal(u.chooseUpdate(dir, '0.1.3'), null); // sin descargas: version instalada

  put('0.1.4');
  assert.equal(u.chooseUpdate(dir, '0.1.3').version, '0.1.4');
  assert.equal(u.readState(dir).boot.attempts, 1);
  u.confirmBoot(dir, '0.1.4'); // la pantalla cargo: arranque bueno
  assert.equal(u.readState(dir).boot, null);
  assert.equal(u.readState(dir).good.version, '0.1.4'); // queda como respaldo
  assert.equal(u.chooseUpdate(dir, '0.1.4'), null); // no es mas nueva que la instalada
  assert.equal(u.chooseUpdate(dir, '0.2.0'), null);

  // Dos arranques sin confirmar de la 0.1.5: al tercero se descarta, queda
  // marcada y se regresa a la ultima que funciono (0.1.4), no a la instalada.
  put('0.1.5');
  assert.equal(u.chooseUpdate(dir, '0.1.3').version, '0.1.5');
  assert.equal(u.chooseUpdate(dir, '0.1.3').version, '0.1.5');
  assert.equal(u.chooseUpdate(dir, '0.1.3').version, '0.1.4');
  assert.deepEqual(u.readState(dir).failed, ['0.1.5']);
  u.confirmBoot(dir, '0.1.4');
  assert.equal(u.chooseUpdate(dir, '0.1.3').version, '0.1.4'); // la 0.1.5 no se vuelve a intentar
  u.confirmBoot(dir, '0.1.4');

  // Archivo alterado despues de descargarlo: se ignora y queda la instalada.
  fs.writeFileSync(path.join(dir, 'code-0.1.4.asar'), 'otra cosa');
  assert.equal(u.chooseUpdate(dir, '0.1.3'), null);

  // Campos que agregue una version futura no se pierden al reescribir.
  u.writeState(dir, { ...u.readState(dir), futuro: 1 });
  u.markFailed(dir, '0.0.1');
  assert.equal(u.readState(dir).futuro, 1);

  // Nombres raros en state.json no se usan como ruta.
  u.writeState(dir, { current: { version: '9.9.9', file: '../../algo.asar', sha256: 'x' }, failed: [] });
  assert.equal(u.chooseUpdate(dir, '0.1.3'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('ticket de venta completo', () => {
  const { orders, cash, settings, find } = setup();
  cash.open({ openingCash: 0 });
  const order = orders.pay({
    label: 'Mesa 2',
    items: [{ productId: find('Milanesa con papas').id, qty: 1 }, { productId: find('Café de olla').id, qty: 2 }],
    method: 'cash',
    cashReceived: 20000,
  });
  const { plain, bytes } = ticket.saleTicket(order, settings.get(), { openDrawer: true });
  for (const row of plain.split('\n')) assert.ok(row.length <= 32, `renglon de mas de 32: "${row}"`);
  assert.match(plain, /1 x Milanesa con papas +\$110\.00/);
  assert.match(plain, /Total +\$150\.00/);
  assert.match(plain, /Cambio +\$50\.00/);
  assert.ok(bytes.includes(Buffer.from([0x1b, 0x70, 0, 25, 250])));
  assert.equal(ticket.money(123456), '$1,234.56');
});
