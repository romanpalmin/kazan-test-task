const crypto = require('crypto');
const db = require('../db/connection');
const { drainPendingPayment } = require('./paymentService');
const { deliverKey } = require('./deliveryService');

const getProduct = db.prepare('SELECT sku, type FROM products WHERE sku = ?');
const insertOrder = db.prepare(`
  INSERT INTO orders (id, sku, status) VALUES (?, ?, 'created')
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
  insertOrder.run(id, sku);
  if (productType === 'key') {
    const claimed = claimKeyForOrder.run(id, sku);
    if (claimed.changes === 0) {
      const err = new Error('Товар закончился — свободных ключей для этого SKU больше нет');
      err.status = 409;
      throw err; // выбрасывание внутри db.transaction откатывает её целиком, включая insertOrder
    }
  }
});

function createOrder(sku) {
  const product = getProduct.get(sku);
  if (!product) {
    const err = new Error(`Неизвестный sku: ${sku}`);
    err.status = 400;
    throw err;
  }
  const id = `ord_${crypto.randomUUID()}`;
  createOrderTxn(id, sku, product.type);

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
