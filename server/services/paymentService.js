const db = require('../db/connection');

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const markPaid = db.prepare(
  `UPDATE orders SET status = 'paid', updated_at = ${now} WHERE id = ? AND status = 'created'`
);
const markPaymentFailed = db.prepare(
  `UPDATE orders SET status = 'payment_failed', updated_at = ${now} WHERE id = ? AND status = 'created'`
);
const getOrderId = db.prepare('SELECT id FROM orders WHERE id = ?');

const upsertPending = db.prepare(`
  INSERT INTO pending_payments (order_id, status, event_id) VALUES (?, ?, ?)
  ON CONFLICT(order_id) DO UPDATE SET
    status = excluded.status,
    event_id = excluded.event_id,
    received_at = ${now}
`);
const getPending = db.prepare('SELECT * FROM pending_payments WHERE order_id = ?');
const deletePending = db.prepare('DELETE FROM pending_payments WHERE order_id = ?');

// Применить факт оплаты к заказу. Атомарный UPDATE — сам себе guard: если
// changes===0, заказ либо ещё не существует, либо уже не в 'created'
// (поздний/лишний вебхук на уже обработанный заказ — тоже нормально,
// просто ничего не делаем).
function applyPayment(orderId, status) {
  const stmt = status === 'paid' ? markPaid : markPaymentFailed;
  const result = stmt.run(orderId);
  return result.changes === 1 ? status : null;
}

function orderExists(orderId) {
  return Boolean(getOrderId.get(orderId));
}

// Запарковать факт оплаты, который не удалось применить сразу (обычно —
// заказа ещё нет). ON CONFLICT — если для этого order_id уже что-то
// запарковано, перезаписываем последним пришедшим фактом.
function parkPayment(orderId, status, eventId) {
  upsertPending.run(orderId, status, eventId);
}

// Вызывается сразу после создания заказа: если платёж уже был запаркован
// (пришёл раньше заказа), применяет его немедленно и убирает парковку.
// Без опроса и фоновой задачи — драйвер этого шага не таймер, а сам факт
// появления заказа.
function drainPendingPayment(orderId) {
  const pending = getPending.get(orderId);
  if (!pending) return null;
  deletePending.run(orderId);
  return applyPayment(orderId, pending.status);
}

module.exports = { applyPayment, orderExists, parkPayment, drainPendingPayment };
