// Catalogo: categorias y productos del menu.
const { UserError, requireText, requireInt } = require('../errors');

const COLOR = /^#[0-9a-fA-F]{6}$/;

module.exports = function createCatalog(db) {
  const categoryById = db.prepare('SELECT * FROM categories WHERE id = ?');
  const productById = db.prepare('SELECT * FROM products WHERE id = ?');

  return {
    listCategories() {
      return db.prepare('SELECT * FROM categories WHERE active = 1 ORDER BY sort, id').all();
    },

    saveCategory({ id, name, color }) {
      const cleanName = requireText(name, 'el nombre de la categoría', 24);
      const cleanColor = COLOR.test(color || '') ? color : '#1B4DB3';
      if (id) {
        if (!categoryById.get(id)) throw new UserError('Esa categoría ya no existe.');
        db.prepare('UPDATE categories SET name = ?, color = ? WHERE id = ?').run(cleanName, cleanColor, id);
        return categoryById.get(id);
      }
      const { next } = db.prepare('SELECT COALESCE(MAX(sort), -1) + 1 AS next FROM categories').get();
      const info = db.prepare('INSERT INTO categories (name, color, sort) VALUES (?, ?, ?)').run(cleanName, cleanColor, next);
      return categoryById.get(info.lastInsertRowid);
    },

    removeCategory(id) {
      const { n } = db.prepare('SELECT COUNT(*) AS n FROM products WHERE category_id = ? AND active = 1').get(id);
      if (n > 0) throw new UserError('La categoría todavía tiene productos. Muévelos o elimínalos primero.');
      db.prepare('UPDATE categories SET active = 0 WHERE id = ?').run(id);
      return true;
    },

    listProducts() {
      return db
        .prepare(
          // shared_stock: cuantos se pueden vender segun sus inventarios
          // compartidos (el que menos alcance manda); NULL si no usa ninguno.
          `SELECT p.*, c.name AS category_name, c.color AS category_color,
                  (SELECT MIN(i.stock / l.qty) FROM product_stock_items l
                     JOIN stock_items i ON i.id = l.item_id AND i.active = 1
                    WHERE l.product_id = p.id) AS shared_stock,
                  (SELECT GROUP_CONCAT(i.name, ', ') FROM product_stock_items l
                     JOIN stock_items i ON i.id = l.item_id AND i.active = 1
                    WHERE l.product_id = p.id) AS shared_names
             FROM products p JOIN categories c ON c.id = p.category_id
            WHERE p.active = 1
            ORDER BY c.sort, c.id, p.name COLLATE NOCASE`
        )
        .all();
    },

    saveProduct({ id, categoryId, name, price, trackStock, stockMin }) {
      const cleanName = requireText(name, 'el nombre del producto', 40);
      requireInt(price, 'El precio');
      requireInt(stockMin || 0, 'El mínimo', { max: 100000 });
      const category = categoryById.get(categoryId);
      if (!category || !category.active) throw new UserError('Elige una categoría.');

      const values = [categoryId, cleanName, price, trackStock ? 1 : 0, stockMin || 0];
      if (id) {
        if (!productById.get(id)) throw new UserError('Ese producto ya no existe.');
        db.prepare(
          'UPDATE products SET category_id = ?, name = ?, price = ?, track_stock = ?, stock_min = ? WHERE id = ?'
        ).run(...values, id);
        return productById.get(id);
      }
      const info = db
        .prepare('INSERT INTO products (category_id, name, price, track_stock, stock_min) VALUES (?, ?, ?, ?, ?)')
        .run(...values);
      return productById.get(info.lastInsertRowid);
    },

    removeProduct(id) {
      db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(id);
      return true;
    },
  };
};
