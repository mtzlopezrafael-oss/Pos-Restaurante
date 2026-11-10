// Reportes de ventas por rango de fechas. Las fechas llegan como 'AAAA-MM-DD'
// en hora local; paid_at esta en UTC y se convierte con 'localtime'.
const { UserError } = require('../errors');

const DAY = /^\d{4}-\d{2}-\d{2}$/;

module.exports = function createReports(db) {
  function sales({ from, to }) {
    if (!DAY.test(from || '') || !DAY.test(to || '') || from > to) {
      throw new UserError('El rango de fechas no es válido.');
    }
    const range = { from, to };
    const paidInRange = "o.status = 'paid' AND date(o.paid_at, 'localtime') BETWEEN @from AND @to";

    const totals = db
      .prepare(`SELECT COUNT(*) AS count, COALESCE(SUM(o.total), 0) AS total FROM orders o WHERE ${paidInRange}`)
      .get(range);

    const byMethod = db
      .prepare(
        `SELECT o.payment_method AS method, COUNT(*) AS count, SUM(o.total) AS total
           FROM orders o WHERE ${paidInRange}
          GROUP BY o.payment_method ORDER BY total DESC`
      )
      .all(range);

    const byDay = db
      .prepare(
        `SELECT date(o.paid_at, 'localtime') AS day, COUNT(*) AS count, SUM(o.total) AS total
           FROM orders o WHERE ${paidInRange}
          GROUP BY day ORDER BY day`
      )
      .all(range);

    const topProducts = db
      .prepare(
        `SELECT MAX(i.name) AS name, SUM(i.qty) AS qty, SUM(i.qty * i.price) AS total
           FROM order_items i JOIN orders o ON o.id = i.order_id
          WHERE ${paidInRange}
          GROUP BY i.product_id ORDER BY total DESC LIMIT 15`
      )
      .all(range);

    const { cancelled } = db
      .prepare(
        `SELECT COUNT(*) AS cancelled FROM orders o
          WHERE o.status = 'cancelled' AND o.paid_at IS NOT NULL
            AND date(o.cancelled_at, 'localtime') BETWEEN @from AND @to`
      )
      .get(range);

    return {
      from,
      to,
      count: totals.count,
      total: totals.total,
      average: totals.count ? Math.round(totals.total / totals.count) : 0,
      cancelled,
      byMethod,
      byDay,
      topProducts,
    };
  }

  return { sales };
};
