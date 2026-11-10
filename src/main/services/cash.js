// Corte de caja: turno con fondo inicial, entradas/salidas y arqueo al cierre.
//
// Efectivo esperado = fondo inicial + ventas en efectivo + entradas - salidas.
// Tarjeta y transferencia se reportan, pero no entran al cajon.
const { UserError, requireText, requireInt, nowIso } = require('../errors');

module.exports = function createCash(db) {
  function currentRow() {
    return db.prepare('SELECT * FROM cash_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1').get() || null;
  }

  function summary(sessionId) {
    const session = db.prepare('SELECT * FROM cash_sessions WHERE id = ?').get(sessionId);
    if (!session) throw new UserError('Ese turno de caja no existe.');

    const sales = { cash: 0, card: 0, transfer: 0 };
    let orderCount = 0;
    const rows = db
      .prepare(
        `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
           FROM orders WHERE session_id = ? AND status = 'paid'
          GROUP BY payment_method`
      )
      .all(sessionId);
    for (const row of rows) {
      sales[row.method] = row.total;
      orderCount += row.count;
    }

    const movements = db
      .prepare('SELECT * FROM cash_movements WHERE session_id = ? ORDER BY id DESC')
      .all(sessionId);
    const cashIn = movements.filter((m) => m.type === 'in').reduce((sum, m) => sum + m.amount, 0);
    const cashOut = movements.filter((m) => m.type === 'out').reduce((sum, m) => sum + m.amount, 0);

    const { cancelledCount } = db
      .prepare("SELECT COUNT(*) AS cancelledCount FROM orders WHERE session_id = ? AND status = 'cancelled'")
      .get(sessionId);
    const { openOrders } = db.prepare("SELECT COUNT(*) AS openOrders FROM orders WHERE status = 'open'").get();

    return {
      session,
      sales,
      salesTotal: sales.cash + sales.card + sales.transfer,
      orderCount,
      cancelledCount,
      openOrders,
      cashIn,
      cashOut,
      expectedCash: session.opening_cash + sales.cash + cashIn - cashOut,
      movements,
    };
  }

  function current() {
    const row = currentRow();
    return row ? summary(row.id) : null;
  }

  function open({ openingCash }) {
    if (currentRow()) throw new UserError('La caja ya está abierta.');
    requireInt(openingCash, 'El fondo inicial');
    db.prepare('INSERT INTO cash_sessions (opened_at, opening_cash) VALUES (?, ?)').run(nowIso(), openingCash);
    return current();
  }

  function addMovement({ type, amount, reason }) {
    const session = currentRow();
    if (!session) throw new UserError('La caja está cerrada.');
    if (type !== 'in' && type !== 'out') throw new UserError('Movimiento no válido.');
    requireInt(amount, 'El monto', { min: 1 });
    const cleanReason = requireText(reason, 'el motivo', 60);
    db.prepare(
      'INSERT INTO cash_movements (session_id, type, amount, reason, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run(session.id, type, amount, cleanReason, nowIso());
    return current();
  }

  const close = db.transaction(({ countedCash, note }) => {
    const session = currentRow();
    if (!session) throw new UserError('La caja ya está cerrada.');
    requireInt(countedCash, 'El efectivo contado');
    const { expectedCash } = summary(session.id);
    db.prepare(
      'UPDATE cash_sessions SET closed_at = ?, expected_cash = ?, counted_cash = ?, note = ? WHERE id = ?'
    ).run(nowIso(), expectedCash, countedCash, String(note || '').trim().slice(0, 120), session.id);
    return summary(session.id);
  });

  function history() {
    return db
      .prepare('SELECT * FROM cash_sessions WHERE closed_at IS NOT NULL ORDER BY id DESC LIMIT 30')
      .all();
  }

  return { currentRow, current, summary, open, addMovement, close, history };
};
