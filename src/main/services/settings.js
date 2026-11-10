// Ajustes del negocio y de la impresora. Se guardan como texto en la tabla
// settings; aqui se definen los valores por defecto y que se acepta en cada uno.
const { UserError } = require('../errors');

const text = (max) => (value) => String(value == null ? '' : value).slice(0, max);
const oneOf = (...options) => (value) => {
  if (!options.includes(String(value))) throw new UserError('Ese valor no es válido.');
  return String(value);
};
const flag = (value) => (value === true || value === '1' || value === 1 ? '1' : '0');
const intBetween = (min, max) => (value) => {
  const n = Number(value);
  if (!Number.isInteger(n) || n < min || n > max) throw new UserError(`Debe ser un número entre ${min} y ${max}.`);
  return String(n);
};

// clave: [valor por defecto, funcion que valida y normaliza]
const SCHEMA = {
  businessName: ['Mi Restaurante', text(32)],
  ticketHeader: ['', text(120)],
  ticketFooter: ['Gracias por su preferencia', text(120)],
  tableCount: ['10', intBetween(1, 40)],
  // file  = guarda el ticket en un archivo (para desarrollar sin impresora)
  // share = impresora USB instalada en Windows y compartida (\\localhost\TICKETS)
  // tcp   = impresora de red (192.168.1.50:9100)
  // port  = puerto serie o paralelo (COM3, LPT1)
  printerMode: ['file', oneOf('file', 'share', 'tcp', 'port')],
  printerTarget: ['', text(80)],
  printerColumns: ['32', oneOf('32', '42', '48')],
  printerEncoding: ['cp850', oneOf('cp850', 'cp1252', 'ascii')],
  printOnPay: ['1', flag],
  drawerOnCash: ['1', flag],
};

module.exports = function createSettings(db) {
  function get() {
    const values = {};
    for (const key of Object.keys(SCHEMA)) values[key] = SCHEMA[key][0];
    for (const row of db.prepare('SELECT key, value FROM settings').all()) {
      if (row.key in SCHEMA) values[row.key] = row.value;
    }
    return values;
  }

  const set = db.transaction((patch) => {
    const upsert = db.prepare(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
    );
    for (const [key, value] of Object.entries(patch || {})) {
      if (!(key in SCHEMA)) continue;
      upsert.run(key, SCHEMA[key][1](value));
    }
    return get();
  });

  return { get, set };
};
