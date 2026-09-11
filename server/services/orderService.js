const crypto = require('crypto');
const db = require('../db/connection');
const { drainPendingPayment } = require('./paymentService');
const { deliverKey } = require('./deliveryService');
const { broadcastStock } = require('./stockEvents');
const { releaseOrderHold } = require('./releaseHold');

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

// Этап 2, задача 3 (бронь с таймером): сколько держится резерв без
// оплаты, прежде чем автоматически освободиться. Настраиваемо через env
// тем же принципом, что и доли отказов поставщика в issuerService.js —
// race-test.js не ждёт реальную минуту, а напрямую состаривает
// reserved_until в БД (см. сценарий там), поэтому даже дефолт в 60с не
// делает тесты медленными.
const RESERVATION_TTL_SECONDS = parseInt(process.env.RESERVATION_TTL_SECONDS ?? '60', 10);
const RESERVATION_MODIFIER = `+${RESERVATION_TTL_SECONDS} seconds`;

const getProduct = db.prepare('SELECT sku, type FROM products WHERE sku = ?');
const insertOrderReserved = db.prepare(`
  INSERT INTO orders (id, sku, status, reserved_until)
  VALUES (?, ?, 'created', strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?))
`);
const insertOrderPlain = db.prepare(`
  INSERT INTO orders (id, sku, status, reserved_until) VALUES (?, ?, 'created', NULL)
`);
const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
const listOrdersStmt = db.prepare(`
  SELECT orders.*, products.name AS product_name
  FROM orders
  JOIN products ON products.sku = orders.sku
  ORDER BY orders.created_at DESC
  LIMIT ?
`);

// Этап 2, задача 2 (гонка за последнюю единицу): резерв ключа переехал
// сюда, на момент создания заказа — раньше keys_pool трогала только
// deliveryService/issuerService, ПОСЛЕ оплаты, а значит второй покупатель
// узнавал об отсутствии остатка уже после "списания" (вебхук paid). Тот
// же атомарный паттерн (issuerService.claimKey), просто вызванный раньше:
// нет свободного ключа — заказ вообще не создаётся, до всякой оплаты.
//
// Только для type='key' — у остальных товаров (topup/subscription/
// giftcard) пула ключей нет вообще ни у одного SKU (см. index.html,
// инфобаннер), и так было задумано с этапа 1: они по-прежнему свободно
// создаются, статус "нет в наличии" всё так же наступает при попытке
// доставки, ничего не меняем для них.
const claimKeyForOrder = db.prepare(`
  UPDATE keys_pool
  SET order_id = ?
  WHERE code = (SELECT code FROM keys_pool WHERE sku = ? AND order_id IS NULL LIMIT 1)
    AND order_id IS NULL
`);

const createOrderTxn = db.transaction((id, sku, productType) => {
  if (productType === 'key') {
    insertOrderReserved.run(id, sku, RESERVATION_MODIFIER);
    const claimed = claimKeyForOrder.run(id, sku);
    if (claimed.changes === 0) {
      const err = new Error('Товар закончился — свободных ключей для этого SKU больше нет');
      err.status = 409;
      throw err; // выбрасывание внутри db.transaction откатывает её целиком, включая insertOrder
    }
  } else {
    insertOrderPlain.run(id, sku);
  }
});

// Этап 2, задача 3: атомарно перевести заказ, чья бронь истекла, в
// терминальный статус reservation_expired и освободить то, что он
// держал (ключ + слот промокода, если был — releaseHold.js, тот же
// принцип, что уже у payment_failed). CAS-гвард `WHERE status =
// 'created'` — тот же идиома, что и везде в проекте: если заказ уже
// оплачен (или уже истёк по другому пути — см. ниже, их два), changes
// будет 0, и это безопасный no-op, а не ошибка.
//
// Вызывается из ДВУХ независимых мест, оба безопасны благодаря этому же
// гварду:
// 1. `setTimeout`, запланированный ниже в момент резерва — основной
//    путь, даёт мгновенный live-эффект (broadcastStock сразу после).
// 2. `sweepExpiredReservations` — подстраховка на случай, если сервер
//    перезапустился и запланированный таймер потерялся (таймеры живут
//    только в памяти процесса): при следующей попытке купить тот же SKU
//    код сначала подметает всё просроченное для него, и только потом
//    решает, есть ли реально свободный ключ.
const expireReservationStmt = db.prepare(
  `UPDATE orders SET status = 'reservation_expired', updated_at = ${now} WHERE id = ? AND status = 'created'`
);
const expireReservationTxn = db.transaction((orderId) => {
  const result = expireReservationStmt.run(orderId);
  if (result.changes === 1) releaseOrderHold(orderId);
  return result.changes;
});

function expireReservation(orderId, sku) {
  const changes = expireReservationTxn(orderId);
  if (changes === 1) broadcastStock(sku); // реально что-то изменилось — не молчим в live-канал попусту
}

function scheduleReservationExpiry(orderId, sku) {
  // .unref() — этот таймер не должен держать процесс живым сам по себе
  // (важно для race-test.js, который завершает процесс раньше, чем
  // дефолтный TTL успел бы истечь, и для штатного graceful shutdown).
  setTimeout(() => expireReservation(orderId, sku), RESERVATION_TTL_SECONDS * 1000).unref();
}

const findExpiredForSku = db.prepare(
  `SELECT id FROM orders WHERE sku = ? AND status = 'created' AND reserved_until IS NOT NULL AND reserved_until < ${now}`
);

function sweepExpiredReservations(sku) {
  // Без broadcastStock на каждую отдельную подметённую бронь — вызывается
  // только из createOrder ниже, прямо перед попыткой захвата, и та сама
  // сделает ровно один broadcastStock с итоговым честным числом после
  // резерва. Если бы здесь тоже слали событие на каждую подметённую
  // бронь, при нескольких брошенных заказах на один SKU подряд другие
  // вкладки увидели бы остаток "мигающим" (0→1→2→3→2) вместо одного
  // финального числа — то же самое итоговое состояние, просто честнее
  // с точки зрения UX одним сообщением.
  for (const { id } of findExpiredForSku.all(sku)) {
    expireReservationTxn(id);
  }
}

function createOrder(sku) {
  const product = getProduct.get(sku);
  if (!product) {
    const err = new Error(`Неизвестный sku: ${sku}`);
    err.status = 400;
    throw err;
  }
  if (product.type === 'key') sweepExpiredReservations(sku);

  const id = `ord_${crypto.randomUUID()}`;
  createOrderTxn(id, sku, product.type);
  broadcastStock(sku); // резерв прошёл успешно (иначе createOrderTxn бросил бы выше) — остаток реально изменился
  if (product.type === 'key') scheduleReservationExpiry(id, sku);

  // Вебхук мог прийти раньше, чем мы успели создать заказ (не по
  // порядку) — если платёж уже запаркован под этим id, применяем его
  // прямо сейчас, без опроса.
  const applied = drainPendingPayment(id);
  if (applied === 'paid') {
    deliverKey(id).catch((err) => {
      console.error(`deliverKey упал для заказа ${id}:`, err);
    });
  }

  return getOrder.get(id); // перечитать — статус мог уже измениться дренажом
}

function findOrder(id) {
  return getOrder.get(id);
}

// Журнал событий для попапа "История" — покупка/заказ/результат в
// одну строку каждый. 100 достаточно с запасом для тестового задания,
// не читаем таблицу молча без ограничения.
function listOrders(limit = 100) {
  return listOrdersStmt.all(limit);
}

module.exports = { createOrder, findOrder, listOrders };
