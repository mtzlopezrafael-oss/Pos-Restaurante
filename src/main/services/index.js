// Arma todos los servicios sobre una misma conexion a la base de datos.
// Las pruebas usan esta misma funcion con una base en memoria.
const createCatalog = require('./catalog');
const createCash = require('./cash');
const createOrders = require('./orders');
const createInventory = require('./inventory');
const createReports = require('./reports');
const createSettings = require('./settings');

function createServices(db) {
  const cash = createCash(db);
  return {
    catalog: createCatalog(db),
    cash,
    orders: createOrders(db, cash), // cobrar necesita saber si la caja esta abierta
    inventory: createInventory(db),
    reports: createReports(db),
    settings: createSettings(db),
  };
}

module.exports = { createServices };
