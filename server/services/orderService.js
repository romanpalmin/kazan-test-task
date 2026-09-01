const crypto = require('crypto');
const db = require('../db/connection');
const { drainPendingPayment } = require('./paymentService');
const { deliverKey } = require('./deliveryService');

const getProduct = db.prepare('SELECT sku FROM products WHERE sku = ?');
const insertOrder = db.prepare(`
  INSERT INTO orders (id, sku, status) VALUES (?, ?, 'created')
`);
const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');

function createOrder(sku) {
  if (!getProduct.get(sku)) {
    const err = new Error(`Неизвестный sku: ${sku}`);
    err.status = 400;
    throw err;
  }
  const id = `ord_${crypto.randomUUID()}`;
  insertOrder.run(id, sku);

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

module.exports = { createOrder, findOrder };
