const db = require('../db/connection');

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const markPaid = db.prepare(
  `UPDATE orders SET status = 'paid', updated_at = ${now} WHERE id = ? AND status = 'created'`
);
const markPaymentFailed = db.prepare(
  `UPDATE orders SET status = 'payment_failed', updated_at = ${now} WHERE id = ? AND status = 'created'`
);
const getOrderId = db.prepare('SELECT id FROM orders WHERE id = ?');
const getOrderPromo = db.prepare('SELECT promo_code FROM orders WHERE id = ?');

// Освободить слот промокода (Этап 4) — used_count не должен считаться
// потраченным, если оплата, под которую он взят, не прошла. Клэмп
// `used_count > 0` — чисто defense-in-depth, отрицательным он стать не
// должен: у одного заказа не может быть двух releasePromoUse (заказ
// либо не в 'created' и promo больше не применить, либо уже
// payment_failed и повторно сюда не попадёт — markPaymentFailed сам
// себе guard, changes===1 только один раз за жизнь заказа).
const releasePromoUse = db.prepare(
  'UPDATE promocodes SET used_count = used_count - 1 WHERE code = ? AND used_count > 0'
);

// Не путать с out_of_stock/delivery_failed (deliveryService.js) — там
// оплата УЖЕ прошла, освобождать промокод не нужно и небезопасно (это
// восстановимое состояние Этапа 3, ручной повтор дожимает ТОТ ЖЕ
// заказ; если бы слот освобождался и тут, его мог перехватить кто-то
// другой, пока админ ещё не запустил повтор). Освобождение — только
// для payment_failed, единственного случая, где заказ окончательно и
// достоверно "не оплачен".
const applyPaymentFailedTxn = db.transaction((orderId) => {
  const result = markPaymentFailed.run(orderId);
  if (result.changes === 1) {
    const order = getOrderPromo.get(orderId);
    if (order && order.promo_code) releasePromoUse.run(order.promo_code);
  }
  return result.changes;
});

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
  if (status === 'paid') {
    const result = markPaid.run(orderId);
    return result.changes === 1 ? status : null;
  }
  const changes = applyPaymentFailedTxn(orderId);
  return changes === 1 ? status : null;
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
