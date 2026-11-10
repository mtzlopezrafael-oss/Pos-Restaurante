// Inventario por producto. Solo aplica a productos con "lleva inventario"
// activado (refrescos, agua embotellada...). Los platillos preparados no se
// cuentan: para eso haria falta un modulo de insumos y recetas.
const { UserError, requireInt, nowIso } = require('../errors');

module.exports = function createInventory(db) {
  const productById = db.prepare('SELECT * FROM products WHERE id = ?');

  function list() {
    return db
      .prepare(
        `SELECT p.id, p.name, p.stock, p.stock_min, c.name AS category_name, c.color AS category_color,
                (p.stock <= p.stock_min) AS low
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.active = 1 AND p.track_stock = 1
          ORDER BY low DESC, p.name COLLATE NOCASE`
      )
      .all();
  }

  // type: 'purchase' suma qty, 'waste' resta qty, 'count' deja el stock en qty.
  const adjust = db.transaction(({ productId, type, qty }) => {
    const product = productById.get(productId);
    if (!product || !product.track_stock) throw new UserError('Ese producto no lleva inventario.');

    let delta;
    let reason;
    if (type === 'purchase') {
      delta = requireInt(qty, 'La cantidad', { min: 1, max: 100000 });
      reason = 'purchase';
    } else if (type === 'waste') {
      delta = -requireInt(qty, 'La cantidad', { min: 1, max: 100000 });
      reason = 'waste';
    } else if (type === 'count') {
      delta = requireInt(qty, 'El conteo', { min: 0, max: 100000 }) - product.stock;
      reason = 'adjust';
    } else {
      throw new UserError('Ajuste no válido.');
    }

    if (delta !== 0) {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, productId);
      db.prepare(
        'INSERT INTO stock_movements (product_id, delta, reason, created_at) VALUES (?, ?, ?, ?)'
      ).run(productId, delta, reason, nowIso());
    }
    return list();
  });

  function movements({ productId }) {
    return db
      .prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 50')
      .all(productId);
  }

  return { list, adjust, movements };
};
