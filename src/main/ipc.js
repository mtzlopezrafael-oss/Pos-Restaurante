// Puente entre la pantalla (renderer) y la logica (proceso principal).
//
// La pantalla llama: window.pos.call('orders.pay', {...})
// Aqui se busca 'orders.pay' en la tabla `handlers` y se ejecuta. Si el nombre
// no esta en la tabla, no existe: la tabla es la lista completa de lo que la
// pantalla tiene permitido hacer.
//
// Toda respuesta viaja como { ok: true, data } o { ok: false, error }, para que
// la pantalla muestre mensajes en espanol y no errores internos de Electron.

const { ipcMain } = require('electron');
const { UserError } = require('./errors');
const ticket = require('./printer/ticket');
const transports = require('./printer/transports');

function registerIpc({ services, dataDir, backup, quit, restart, updater, confirmHealthy, appInfo }) {
  const { catalog, orders, cash, inventory, reports, settings } = services;

  const print = (doc) => transports.send(doc, settings.get(), dataDir);

  // Imprimir nunca debe tumbar una venta ya cobrada: si la impresora falla,
  // la venta queda guardada y la pantalla solo avisa.
  async function tryPrint(makeDoc) {
    try {
      await print(makeDoc());
      return null;
    } catch (error) {
      if (!(error instanceof UserError)) console.error(error);
      return error instanceof UserError ? error.message : 'No se pudo imprimir.';
    }
  }

  const handlers = {
    'catalog.listCategories': () => catalog.listCategories(),
    'catalog.saveCategory': (p) => catalog.saveCategory(p),
    'catalog.removeCategory': (p) => catalog.removeCategory(p.id),
    'catalog.listProducts': () => catalog.listProducts(),
    'catalog.saveProduct': (p) => catalog.saveProduct(p),
    'catalog.removeProduct': (p) => catalog.removeProduct(p.id),

    'orders.listOpen': () => orders.listOpen(),
    'orders.listSession': () => orders.listSession(),
    'orders.get': (p) => orders.get(p.id),
    'orders.save': (p) => orders.save(p),
    'orders.cancel': (p) => orders.cancel(p.id),
    'orders.pay': async (p) => {
      const order = orders.pay(p);
      const config = settings.get();
      const openDrawer = order.payment_method === 'cash' && config.drawerOnCash === '1';
      let printError = null;
      if (config.printOnPay === '1') {
        printError = await tryPrint(() => ticket.saleTicket(order, config, { openDrawer }));
      } else if (openDrawer) {
        printError = await tryPrint(() => ticket.drawerPulse(config));
      }
      return { order, printError };
    },
    'orders.reprint': async (p) => {
      const order = orders.get(p.id);
      if (!order) throw new UserError('Esa cuenta no existe.');
      await print(ticket.saleTicket(order, settings.get()));
      return true;
    },

    'cash.current': () => cash.current(),
    'cash.history': () => cash.history(),
    'cash.open': (p) => cash.open(p),
    'cash.addMovement': (p) => cash.addMovement(p),
    'cash.close': async (p) => {
      const summary = cash.close(p);
      const printError = await tryPrint(() => ticket.cashCloseTicket(summary, settings.get()));
      // Respaldo automatico de la base de datos en cada cierre de caja.
      backup().catch((error) => console.error('Fallo el respaldo:', error));
      return { summary, printError };
    },

    'inventory.list': () => inventory.list(),
    'inventory.adjust': (p) => inventory.adjust(p),
    'inventory.movements': (p) => inventory.movements(p),
    'inventory.saveItem': (p) => inventory.saveItem(p),
    'inventory.removeItem': (p) => inventory.removeItem(p),
    'inventory.adjustItem': (p) => inventory.adjustItem(p),
    'inventory.itemProducts': (p) => inventory.itemProducts(p),
    'inventory.setItemProducts': (p) => inventory.setItemProducts(p),
    'inventory.productItems': (p) => inventory.productItems(p),
    'inventory.setProductItems': (p) => inventory.setProductItems(p),

    'reports.sales': (p) => reports.sales(p),

    'settings.get': () => settings.get(),
    'settings.set': (p) => settings.set(p),

    'printer.test': async () => {
      return print(ticket.testTicket(settings.get()));
    },
    'printer.drawer': async () => {
      await print(ticket.drawerPulse(settings.get()));
      return true;
    },

    'update.status': () => updater.status(),
    'update.check': () => updater.check(),
    'update.restart': () => {
      restart();
      return true;
    },

    'app.info': () => appInfo,
    // La pantalla avisa que ya cargo: con eso el lanzador da por buena la version.
    'app.ready': () => {
      confirmHealthy();
      return true;
    },
    'app.quit': () => {
      quit();
      return true;
    },
  };

  ipcMain.handle('pos', async (event, name, payload) => {
    const handler = handlers[name];
    if (!handler) return { ok: false, error: `Operación desconocida: ${name}` };
    try {
      return { ok: true, data: await handler(payload || {}) };
    } catch (error) {
      if (error instanceof UserError) return { ok: false, error: error.message };
      console.error(`[${name}]`, error);
      return { ok: false, error: 'Ocurrió un error inesperado. Intenta de nuevo.' };
    }
  });
}

module.exports = { registerIpc };
