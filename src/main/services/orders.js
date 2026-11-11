// Cuentas: guardar una cuenta abierta (mesa), cobrarla y cancelarla.
//
// La pantalla solo manda { productId, qty, note } por renglon. El nombre y el
// precio se leen aqui, de la base de datos: asi un error (o alguien curioseando
// en el renderer) no puede cobrar con un precio inventado.
const { UserError, requireInt, nowIso } = require('../errors');

const METHODS = ['cash', 'card', 'transfer'];

module.exports = function createOrders(db, cash) {
  const orderById = db.prepare('SELECT * FROM orders WHERE id = ?');
  const itemsOf = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY id');
  const productById = db.prepare('SELECT * FROM products WHERE id = ?');
  const insertItem = db.prepare(
    'INSERT INTO order_items (order_id, product_id, name, price, qty, note) VALUES (?, ?, ?, ?, ?, ?)'
  );
  const moveStock = db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?');
  const logStock = db.prepare(
    'INSERT INTO stock_movements (product_id, delta, reason, order_id, created_at) VALUES (?, ?, ?, ?, ?)'
  );
  // Inventario compartido (ver inventory.js): de cuales descuenta un producto.
  const sharedOf = db.prepare(
    `SELECT l.item_id, l.qty FROM product_stock_items l JOIN stock_items i ON i.id = l.item_id
      WHERE l.product_id = ? AND i.active = 1`
  );
  const moveShared = db.prepare('UPDATE stock_items SET stock = stock + ? WHERE id = ?');
  const logShared = db.prepare(
    'INSERT INTO stock_item_movements (item_id, delta, reason, order_id, created_at) VALUES (?, ?, ?, ?, ?)'
  );

  function get(id) {
    const order = orderById.get(id);
    return order ? { ...order, items: itemsOf.all(id) } : null;
  }

  // Reemplaza los renglones de una cuenta y recalcula su total.
  function writeItems(orderId, items) {
    if (!Array.isArray(items) || items.length === 0) throw new UserError('La cuenta está vacía.');
    db.prepare('DELETE FROM order_items WHERE order_id = ?').run(orderId);
    let total = 0;
    for (const item of items) {
      const product = productById.get(item.productId);
      if (!product) throw new UserError('Un producto de la cuenta ya no existe.');
      const qty = requireInt(item.qty, 'La cantidad', { min: 1, max: 999 });
      const note = String(item.note || '').trim().slice(0, 60);
      insertItem.run(orderId, product.id, product.name, product.price, qty, note);
      total += product.price * qty;
    }
    db.prepare('UPDATE orders SET total = ? WHERE id = ?').run(total, orderId);
  }

  // Crea la cuenta si no trae id; si lo trae, la actualiza (debe seguir abierta).
  function upsertOpen({ id, label, items }) {
    const cleanLabel = String(label || '').trim().slice(0, 30);
    let orderId = id;
    if (orderId) {
      const existing = orderById.get(orderId);
      if (!existing || existing.status !== 'open') {
        throw new UserError('Esa cuenta ya fue cobrada o cancelada.');
      }
      db.prepare('UPDATE orders SET label = ? WHERE id = ?').run(cleanLabel, orderId);
    } else {
      orderId = db.prepare('INSERT INTO orders (label, created_at) VALUES (?, ?)').run(cleanLabel, nowIso())
        .lastInsertRowid;
    }
    writeItems(orderId, items);
    return orderId;
  }

  // db.transaction envuelve la funcion: si algo lanza un error a la mitad,
  // SQLite deshace todo lo que se habia escrito. Nunca queda una venta a medias.
  const save = db.transaction((payload) => {
    if (!String(payload.label || '').trim()) {
      throw new UserError('Ponle nombre a la cuenta (mesa o cliente) para guardarla.');
    }
    return get(upsertOpen(payload));
  });

  const pay = db.transaction((payload) => {
    const session = cash.currentRow();
    if (!session) throw new UserError('La caja está cerrada. Ábrela para poder cobrar.');
    if (!METHODS.includes(payload.method)) throw new UserError('Elige la forma de pago.');

    const orderId = upsertOpen(payload);
    const { total } = orderById.get(orderId);

    let received = null;
    let change = null;
    if (payload.method === 'cash') {
      received = requireInt(payload.cashReceived, 'El efectivo recibido');
      if (received < total) throw new UserError('El efectivo recibido no cubre el total.');
      change = received - total;
    }

    const now = nowIso();
    db.prepare(
      `UPDATE orders
          SET status = 'paid', payment_method = ?, cash_received = ?, change_given = ?,
              session_id = ?, paid_at = ?
        WHERE id = ?`
    ).run(payload.method, received, change, session.id, now, orderId);

    // El inventario se descuenta al cobrar, no al agregar a la cuenta.
    // Se permite quedar en negativo: es preferible vender y corregir el conteo
    // que bloquear la caja porque el inventario estaba mal capturado.
    for (const item of itemsOf.all(orderId)) {
      // Inventario propio del producto.
      if (productById.get(item.product_id).track_stock) {
        moveStock.run(-item.qty, item.product_id);
        logStock.run(item.product_id, -item.qty, 'sale', orderId, now);
      }
      // Inventarios compartidos a los que esta vinculado (vaso, tapa...).
      for (const link of sharedOf.all(item.product_id)) {
        const used = link.qty * item.qty;
        moveShared.run(-used, link.item_id);
        logShared.run(link.item_id, -used, 'sale', orderId, now);
      }
    }
    return get(orderId);
  });

  const cancel = db.transaction((id) => {
    const order = orderById.get(id);
    if (!order) throw new UserError('Esa cuenta no existe.');
    if (order.status === 'cancelled') throw new UserError('Esa cuenta ya estaba cancelada.');

    if (order.status === 'paid') {
      const session = cash.currentRow();
      if (!session || session.id !== order.session_id) {
        throw new UserError('Solo se pueden cancelar ventas del turno de caja que está abierto.');
      }
      // Regresa al inventario exactamente lo que esta venta habia descontado.
      const sold = db
        .prepare("SELECT product_id, delta FROM stock_movements WHERE order_id = ? AND reason = 'sale'")
        .all(id);
      const now = nowIso();
      for (const movement of sold) {
        moveStock.run(-movement.delta, movement.product_id);
        logStock.run(movement.product_id, -movement.delta, 'cancel', id, now);
      }
      const shared = db
        .prepare("SELECT item_id, delta FROM stock_item_movements WHERE order_id = ? AND reason = 'sale'")
        .all(id);
      for (const movement of shared) {
        moveShared.run(-movement.delta, movement.item_id);
        logShared.run(movement.item_id, -movement.delta, 'cancel', id, now);
      }
    }
    db.prepare("UPDATE orders SET status = 'cancelled', cancelled_at = ? WHERE id = ?").run(nowIso(), id);
    return get(id);
  });

  return {
    get,
    save,
    pay,
    cancel,

    listOpen() {
      return db
        .prepare(
          `SELECT o.*, (SELECT COALESCE(SUM(qty), 0) FROM order_items WHERE order_id = o.id) AS item_count
             FROM orders o
            WHERE o.status = 'open'
            ORDER BY o.created_at`
        )
        .all();
    },

    // Ventas del turno abierto, para reimprimir o cancelar.
    listSession() {
      const session = cash.currentRow();
      if (!session) return [];
      return db
        .prepare(
          `SELECT * FROM orders
            WHERE session_id = ? AND status IN ('paid', 'cancelled')
            ORDER BY paid_at DESC LIMIT 300`
        )
        .all(session.id);
    },
  };
};
