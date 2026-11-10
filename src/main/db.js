// Conexion a SQLite y migraciones del esquema.
//
// Reglas del esquema:
//   - El dinero se guarda en CENTAVOS como entero ($45.50 -> 4550). Los decimales
//     de JavaScript (0.1 + 0.2 = 0.30000000000000004) descuadran una caja.
//   - Las fechas se guardan en UTC (texto ISO). Para agrupar por dia se convierten
//     con date(x, 'localtime'), que usa la zona horaria de Windows.
//   - Nada se borra de verdad: productos y categorias se desactivan (active = 0)
//     para que las ventas viejas sigan teniendo a que apuntar.

const Database = require('better-sqlite3');

// Cada elemento es una version del esquema. Para cambiar tablas en el futuro
// NO edites una migracion existente: agrega otra al final.
// Las migraciones deben solo AGREGAR (tablas, columnas): si una actualizacion
// falla y el programa regresa a la version anterior, ese codigo viejo tiene
// que poder seguir trabajando con la base ya migrada. PRAGMA user_version
// guarda cuantas ya se aplicaron en cada base de datos.
const MIGRATIONS = [
  `
  CREATE TABLE settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE categories (
    id     INTEGER PRIMARY KEY,
    name   TEXT    NOT NULL,
    color  TEXT    NOT NULL DEFAULT '#1B4DB3',
    sort   INTEGER NOT NULL DEFAULT 0,
    active INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE products (
    id          INTEGER PRIMARY KEY,
    category_id INTEGER NOT NULL REFERENCES categories(id),
    name        TEXT    NOT NULL,
    price       INTEGER NOT NULL CHECK (price >= 0),
    track_stock INTEGER NOT NULL DEFAULT 0,
    stock       INTEGER NOT NULL DEFAULT 0,
    stock_min   INTEGER NOT NULL DEFAULT 0,
    active      INTEGER NOT NULL DEFAULT 1
  );

  -- Un turno de caja: se abre con un fondo y se cierra con el arqueo.
  CREATE TABLE cash_sessions (
    id            INTEGER PRIMARY KEY,
    opened_at     TEXT    NOT NULL,
    closed_at     TEXT,
    opening_cash  INTEGER NOT NULL CHECK (opening_cash >= 0),
    expected_cash INTEGER,
    counted_cash  INTEGER,
    note          TEXT    NOT NULL DEFAULT ''
  );

  -- Entradas y salidas de efectivo que no son ventas (pago a proveedor, cambio...).
  CREATE TABLE cash_movements (
    id         INTEGER PRIMARY KEY,
    session_id INTEGER NOT NULL REFERENCES cash_sessions(id),
    type       TEXT    NOT NULL CHECK (type IN ('in', 'out')),
    amount     INTEGER NOT NULL CHECK (amount > 0),
    reason     TEXT    NOT NULL,
    created_at TEXT    NOT NULL
  );

  -- Una cuenta. Nace 'open' (mesa con cuenta abierta) y termina 'paid' o 'cancelled'.
  CREATE TABLE orders (
    id             INTEGER PRIMARY KEY,
    label          TEXT    NOT NULL DEFAULT '',
    status         TEXT    NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'paid', 'cancelled')),
    total          INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT    CHECK (payment_method IN ('cash', 'card', 'transfer')),
    cash_received  INTEGER,
    change_given   INTEGER,
    session_id     INTEGER REFERENCES cash_sessions(id),
    created_at     TEXT    NOT NULL,
    paid_at        TEXT,
    cancelled_at   TEXT
  );

  -- name y price son una COPIA del producto al momento de la venta: si manana
  -- sube el precio, los tickets de hoy no cambian.
  CREATE TABLE order_items (
    id         INTEGER PRIMARY KEY,
    order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    name       TEXT    NOT NULL,
    price      INTEGER NOT NULL,
    qty        INTEGER NOT NULL CHECK (qty > 0),
    note       TEXT    NOT NULL DEFAULT ''
  );

  -- Bitacora del inventario: cada cambio de existencias deja un renglon.
  CREATE TABLE stock_movements (
    id         INTEGER PRIMARY KEY,
    product_id INTEGER NOT NULL REFERENCES products(id),
    delta      INTEGER NOT NULL,
    reason     TEXT    NOT NULL
               CHECK (reason IN ('sale', 'purchase', 'waste', 'adjust', 'cancel')),
    order_id   INTEGER REFERENCES orders(id),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_orders_status  ON orders(status);
  CREATE INDEX idx_orders_paid_at ON orders(paid_at);
  CREATE INDEX idx_orders_session ON orders(session_id);
  CREATE INDEX idx_items_order    ON order_items(order_id);
  CREATE INDEX idx_stock_product  ON stock_movements(product_id);
  `,

  // 2. Inventario compartido: un inventario (p. ej. "Vaso 1/2 litro") del que
  //    descuentan varios productos. Solo agrega tablas; no toca las anteriores.
  `
  CREATE TABLE stock_items (
    id        INTEGER PRIMARY KEY,
    name      TEXT    NOT NULL,
    stock     INTEGER NOT NULL DEFAULT 0,
    stock_min INTEGER NOT NULL DEFAULT 0,
    active    INTEGER NOT NULL DEFAULT 1
  );

  -- Que productos descuentan de que inventario, y cuantas piezas por venta.
  CREATE TABLE product_stock_items (
    product_id INTEGER NOT NULL REFERENCES products(id),
    item_id    INTEGER NOT NULL REFERENCES stock_items(id),
    qty        INTEGER NOT NULL DEFAULT 1 CHECK (qty > 0),
    PRIMARY KEY (product_id, item_id)
  );

  -- Bitacora del inventario compartido (la de productos es stock_movements).
  CREATE TABLE stock_item_movements (
    id         INTEGER PRIMARY KEY,
    item_id    INTEGER NOT NULL REFERENCES stock_items(id),
    delta      INTEGER NOT NULL,
    reason     TEXT    NOT NULL
               CHECK (reason IN ('sale', 'purchase', 'waste', 'adjust', 'cancel')),
    order_id   INTEGER REFERENCES orders(id),
    created_at TEXT    NOT NULL
  );

  CREATE INDEX idx_links_item      ON product_stock_items(item_id);
  CREATE INDEX idx_item_moves_item ON stock_item_movements(item_id);
  CREATE INDEX idx_item_moves_order ON stock_item_movements(order_id);
  `,
];

function migrate(db) {
  const applied = db.pragma('user_version', { simple: true });
  for (let version = applied; version < MIGRATIONS.length; version++) {
    // Transaccion: la migracion se aplica completa o no se aplica.
    db.transaction(() => {
      db.exec(MIGRATIONS[version]);
      db.pragma(`user_version = ${version + 1}`);
    })();
  }
}

// Datos de ejemplo para que la primera pantalla no salga vacia.
// Se editan o eliminan desde la pantalla Productos.
function seedIfEmpty(db) {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM categories').get();
  if (n > 0) return;

  const addCategory = db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)');
  const addProduct = db.prepare(
    'INSERT INTO products (category_id, name, price, track_stock, stock, stock_min) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const menu = [
    ['Comidas', '#C2410C', [['Comida corrida', 9000], ['Enchiladas', 8500], ['Chilaquiles', 7500], ['Milanesa con papas', 11000]]],
    ['Antojitos', '#B4236B', [['Taco', 2000], ['Quesadilla', 3000], ['Gordita', 2800], ['Sope', 2800]]],
    ['Bebidas', '#1B4DB3', [['Refresco 600 ml', 2500, 24, 6], ['Agua embotellada', 1500, 24, 6], ['Agua fresca', 2000], ['Café de olla', 2000]]],
    ['Postres', '#6D3FB5', [['Flan', 3000], ['Gelatina', 1800]]],
  ];

  db.transaction(() => {
    menu.forEach(([name, color, products], index) => {
      const categoryId = addCategory.run(name, color, index).lastInsertRowid;
      for (const [productName, price, stock, stockMin] of products) {
        const tracked = stock !== undefined;
        addProduct.run(categoryId, productName, price, tracked ? 1 : 0, stock || 0, stockMin || 0);
      }
    });
  })();
}

// beforeMigrate(db): se llama con la base ya abierta y ANTES de aplicar
// migraciones; main.js lo usa para sacar una copia al estrenar version.
function openDatabase(file, { beforeMigrate } = {}) {
  const db = new Database(file);
  // WAL: las lecturas no bloquean a las escrituras y aguanta mejor un apagon.
  db.pragma('journal_mode = WAL');
  // FULL: cada venta queda escrita en disco antes de continuar. Es mas lento
  // que NORMAL, pero en una caja importa mas no perder la ultima venta.
  db.pragma('synchronous = FULL');
  db.pragma('foreign_keys = ON');
  if (beforeMigrate) beforeMigrate(db);
  migrate(db);
  seedIfEmpty(db);
  return db;
}

module.exports = { openDatabase };
