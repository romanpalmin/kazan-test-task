const db = require('../db/connection');
const issuer = require('./issuerService');

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Атомарный переход paid → delivering — это и есть guard "не начинать
// выдачу дважды". changes===0 означает "заказ не в paid прямо сейчас"
// (уже кто-то обрабатывает, уже доставлен, или ещё не оплачен) — в этом
// случае просто ничего не делаем, без отдельной проверки статуса заранее
// (check-then-act здесь не нужен, UPDATE сам себе проверка).
const claimForDelivery = db.prepare(
  `UPDATE orders SET status = 'delivering', updated_at = ${now} WHERE id = ? AND status = 'paid'`
);
const setRequestId = db.prepare(
  `UPDATE orders SET issue_request_id = ?, updated_at = ${now} WHERE id = ?`
);
const finalizeDelivered = db.prepare(
  `UPDATE orders SET status = 'delivered', issued_code = ?, updated_at = ${now} WHERE id = ? AND status = 'delivering'`
);
const setOutOfStock = db.prepare(
  `UPDATE orders SET status = 'out_of_stock', updated_at = ${now} WHERE id = ? AND status = 'delivering'`
);
const setDeliveryFailed = db.prepare(
  `UPDATE orders SET status = 'delivery_failed', updated_at = ${now} WHERE id = ? AND status = 'delivering'`
);
const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');

// Обращение к одному поставщику + один повтор ТЕМ ЖЕ request_id, если
// первая попытка "потерялась" по таймауту — ровно тот сценарий, который
// issuer_ledger обязан развернуть в тот же код, а не в новую выдачу.
async function attemptWithRetry(requestId, sku, orderId, provider) {
  let result = await issuer.issue({ requestId, sku, orderId, provider });
  if (!result.ok && result.reason === 'timeout') {
    result = await issuer.issue({ requestId, sku, orderId, provider });
  }
  return result;
}

/**
 * Довести заказ из paid до delivered/out_of_stock/delivery_failed.
 * Идемпотентна на уровне заказа: если заказ уже не в paid, тихо
 * выходит — безопасно вызывать повторно (админ Этапа 3, race у
 * вызывающего кода и т.п.).
 */
async function deliverKey(orderId) {
  const claimed = claimForDelivery.run(orderId);
  if (claimed.changes === 0) return; // не наш момент — уже обрабатывается или не оплачен

  const order = getOrder.get(orderId);

  const requestIdA = `${orderId}-1`;
  setRequestId.run(requestIdA, orderId);
  let result = await attemptWithRetry(requestIdA, order.sku, orderId, 'A');

  // out_of_stock — факт про общий пул, пробовать другого поставщика
  // бессмысленно (см. ER-диаграмму: оба читают один keys_pool).
  if (!result.ok && result.reason !== 'out_of_stock') {
    const requestIdB = `${orderId}-2`;
    setRequestId.run(requestIdB, orderId);
    result = await attemptWithRetry(requestIdB, order.sku, orderId, 'B');
  }

  if (result.ok) {
    finalizeDelivered.run(result.code, orderId);
  } else if (result.reason === 'out_of_stock') {
    setOutOfStock.run(orderId);
  } else {
    setDeliveryFailed.run(orderId);
  }
}

module.exports = { deliverKey };
