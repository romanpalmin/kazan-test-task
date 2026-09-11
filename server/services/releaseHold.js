const db = require('../db/connection');

const getOrderPromo = db.prepare('SELECT promo_code FROM orders WHERE id = ?');

// Освободить слот промокода (Этап 4) — used_count не должен считаться
// потраченным, если оплата, под которую он взят, не прошла. Клэмп
// `used_count > 0` — чисто defense-in-depth, отрицательным он стать не
// должен.
const releasePromoUse = db.prepare(
  'UPDATE promocodes SET used_count = used_count - 1 WHERE code = ? AND used_count > 0'
);

// Резерв ключа (Этап 2, задача 2) — WHERE order_id = ? безопасен как
// no-op для заказов без резерва (товары без пула ключей): обновит 0
// строк, не упадёт.
const releaseKeyReservation = db.prepare('UPDATE keys_pool SET order_id = NULL WHERE order_id = ?');

// Общая для ДВУХ независимых переходов, у которых один и тот же смысл —
// "заказ окончательно и достоверно не будет оплачен": payment_failed
// (paymentService.js, оплата реально провалилась) и reservation_expired
// (orderService.js, Этап 2 задача 3 — бронь истекла без оплаты). Оба
// освобождают одно и то же: слот промокода, если был применён, и резерв
// ключа, если был. Разница между ними — только в том, КАКОЙ статус
// перед этим атомарно выставился (CAS-гвард всегда снаружи, в
// вызывающем коде, ДО вызова этой функции — она сама статус не
// проверяет и не трогает, только освобождает то, что реально держал
// заказ).
function releaseOrderHold(orderId) {
  const order = getOrderPromo.get(orderId);
  if (order && order.promo_code) releasePromoUse.run(order.promo_code);
  releaseKeyReservation.run(orderId);
}

module.exports = { releaseOrderHold };
