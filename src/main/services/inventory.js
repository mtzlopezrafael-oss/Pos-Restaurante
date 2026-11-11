// Inventario. Hay dos formas de llevarlo y un producto puede usar cualquiera:
//
//   Propio      El producto se cuenta a si mismo (un refresco, un agua
//               embotellada). Son las columnas stock / stock_min de products.
//
//   Compartido  Un "inventario" aparte (tabla stock_items), por ejemplo
//               "Vaso 1/2 litro", al que se vinculan varios productos: todos
//               los sabores que se sirven en ese vaso. Vender cualquiera
//               descuenta del mismo inventario. Un producto puede estar
//               vinculado a varios (vaso + tapa).
//
// El descuento al cobrar y la devolucion al cancelar estan en orders.js.
const { UserError, requireText, requireInt, nowIso } = require('../errors');

module.exports = function createInventory(db) {
  const productById = db.prepare('SELECT * FROM products WHERE id = ?');
  const itemById = db.prepare('SELECT * FROM stock_items WHERE id = ? AND active = 1');

  function list() {
    const items = db
      .prepare(
        `SELECT i.id, i.name, i.stock, i.stock_min, (i.stock <= i.stock_min) AS low,
                (SELECT COUNT(*) FROM product_stock_items l JOIN products p ON p.id = l.product_id
                  WHERE l.item_id = i.id AND p.active = 1) AS product_count
           FROM stock_items i
          WHERE i.active = 1
          ORDER BY low DESC, i.name COLLATE NOCASE`
      )
      .all();
    const products = db
      .prepare(
        `SELECT p.id, p.name, p.stock, p.stock_min, c.name AS category_name, c.color AS category_color,
                (p.stock <= p.stock_min) AS low
           FROM products p JOIN categories c ON c.id = p.category_id
          WHERE p.active = 1 AND p.track_stock = 1
          ORDER BY low DESC, p.name COLLATE NOCASE`
      )
      .all();
    return { items, products };
  }

  // Cuanto cambia el stock. type: 'purchase' suma qty, 'waste' resta qty,
  // 'count' deja el stock en qty (corrige contra lo que hay fisicamente).
  function change(type, qty, current) {
    if (type === 'purchase') return { delta: requireInt(qty, 'La cantidad', { min: 1, max: 100000 }), reason: 'purchase' };
    if (type === 'waste') return { delta: -requireInt(qty, 'La cantidad', { min: 1, max: 100000 }), reason: 'waste' };
    if (type === 'count') return { delta: requireInt(qty, 'El conteo', { min: 0, max: 100000 }) - current, reason: 'adjust' };
    throw new UserError('Ajuste no válido.');
  }

  // ---------- Inventario propio de un producto ----------
  const adjust = db.transaction(({ productId, type, qty }) => {
    const product = productById.get(productId);
    if (!product || !product.track_stock) throw new UserError('Ese producto no lleva inventario.');
    const { delta, reason } = change(type, qty, product.stock);
    if (delta !== 0) {
      db.prepare('UPDATE products SET stock = stock + ? WHERE id = ?').run(delta, productId);
      db.prepare('INSERT INTO stock_movements (product_id, delta, reason, created_at) VALUES (?, ?, ?, ?)').run(
        productId, delta, reason, nowIso()
      );
    }
    return list();
  });

  function movements({ productId }) {
    return db.prepare('SELECT * FROM stock_movements WHERE product_id = ? ORDER BY id DESC LIMIT 50').all(productId);
  }

  // ---------- Inventario compartido ----------
  function saveItem({ id, name, stockMin }) {
    const cleanName = requireText(name, 'el nombre del inventario', 40);
    requireInt(stockMin || 0, 'El mínimo', { max: 100000 });
    if (id) {
      if (!itemById.get(id)) throw new UserError('Ese inventario ya no existe.');
      db.prepare('UPDATE stock_items SET name = ?, stock_min = ? WHERE id = ?').run(cleanName, stockMin || 0, id);
    } else {
      db.prepare('INSERT INTO stock_items (name, stock_min) VALUES (?, ?)').run(cleanName, stockMin || 0);
    }
    return list();
  }

  // Se desactiva (no se borra) para conservar su historial; sus productos
  // quedan desvinculados y dejan de descontar.
  const removeItem = db.transaction(({ id }) => {
    db.prepare('DELETE FROM product_stock_items WHERE item_id = ?').run(id);
    db.prepare('UPDATE stock_items SET active = 0 WHERE id = ?').run(id);
    return list();
  });

  const adjustItem = db.transaction(({ itemId, type, qty }) => {
    const item = itemById.get(itemId);
    if (!item) throw new UserError('Ese inventario ya no existe.');
    const { delta, reason } = change(type, qty, item.stock);
    if (delta !== 0) {
      db.prepare('UPDATE stock_items SET stock = stock + ? WHERE id = ?').run(delta, itemId);
      db.prepare('INSERT INTO stock_item_movements (item_id, delta, reason, created_at) VALUES (?, ?, ?, ?)').run(
        itemId, delta, reason, nowIso()
      );
    }
    return list();
  });

  // ---------- Vinculos producto <-> inventario compartido ----------
  // Deja a `owner` vinculado exactamente con los ids de `wanted`: quita los
  // que sobran y agrega los que faltan. Los que ya estaban no se tocan.
  function replaceLinks(ownerColumn, otherColumn, ownerId, wanted) {
    if (!Array.isArray(wanted) || wanted.some((id) => !Number.isInteger(id))) throw new UserError('Selección no válida.');
    const current = db.prepare(`SELECT ${otherColumn} AS id FROM product_stock_items WHERE ${ownerColumn} = ?`).all(ownerId).map((r) => r.id);
    const remove = db.prepare(`DELETE FROM product_stock_items WHERE ${ownerColumn} = ? AND ${otherColumn} = ?`);
    const add = db.prepare(`INSERT INTO product_stock_items (${ownerColumn}, ${otherColumn}) VALUES (?, ?)`);
    for (const id of current) if (!wanted.includes(id)) remove.run(ownerId, id);
    for (const id of wanted) if (!current.includes(id)) add.run(ownerId, id);
  }

  function itemProducts({ itemId }) {
    // Solo productos vigentes: uno eliminado no aparece en pantalla y, al
    // guardar la seleccion, su vinculo viejo se quita.
    return db
      .prepare(
        `SELECT l.product_id FROM product_stock_items l JOIN products p ON p.id = l.product_id
          WHERE l.item_id = ? AND p.active = 1`
      )
      .all(itemId)
      .map((r) => r.product_id);
  }

  const setItemProducts = db.transaction(({ itemId, productIds }) => {
    if (!itemById.get(itemId)) throw new UserError('Ese inventario ya no existe.');
    for (const id of productIds || []) if (!productById.get(id)) throw new UserError('Un producto de la selección ya no existe.');
    replaceLinks('item_id', 'product_id', itemId, productIds);
    return list();
  });

  function productItems({ productId }) {
    return db
      .prepare(
        `SELECT l.item_id FROM product_stock_items l JOIN stock_items i ON i.id = l.item_id
          WHERE l.product_id = ? AND i.active = 1`
      )
      .all(productId)
      .map((r) => r.item_id);
  }

  const setProductItems = db.transaction(({ productId, itemIds }) => {
    if (!productById.get(productId)) throw new UserError('Ese producto ya no existe.');
    for (const id of itemIds || []) if (!itemById.get(id)) throw new UserError('Un inventario de la selección ya no existe.');
    replaceLinks('product_id', 'item_id', productId, itemIds);
    return true;
  });

  return { list, adjust, movements, saveItem, removeItem, adjustItem, itemProducts, setItemProducts, productItems, setProductItems };
};
