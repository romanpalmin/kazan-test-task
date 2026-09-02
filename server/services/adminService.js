const crypto = require('crypto');
const db = require('../db/connection');

const listStuckStmt = db.prepare(`
  SELECT orders.*, products.name AS product_name
  FROM orders
  JOIN products ON products.sku = orders.sku
  WHERE orders.status IN ('out_of_stock', 'delivery_failed')
  ORDER BY orders.updated_at ASC
`);

const stockLevelsStmt = db.prepare(`
  SELECT sku, COUNT(*) AS available
  FROM keys_pool
  WHERE order_id IS NULL
  GROUP BY sku
`);

const getProduct = db.prepare('SELECT sku FROM products WHERE sku = ?');
const insertKey = db.prepare('INSERT INTO keys_pool (code, sku, order_id) VALUES (?, ?, NULL)');

// "Оплачен, но не выдан" — обе восстановимые ветки из статус-машины
// задания (out_of_stock: пул был пуст; delivery_failed: оба поставщика
// упали). Сортировка по updated_at ASC — старейшие сначала, как в любой
// живой очереди разбора инцидентов.
function listStuckOrders() {
  return listStuckStmt.all();
}

function getStockLevels() {
  return stockLevelsStmt.all();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // без похожих друг на друга символов (0/O, 1/I)

function randomGroup() {
  let group = '';
  for (let i = 0; i < 4; i++) {
    group += ALPHABET[crypto.randomInt(ALPHABET.length)];
  }
  return group;
}

function generateCode() {
  return `${randomGroup()}-${randomGroup()}-${randomGroup()}`;
}

// Пополнение пула для sku — админ "закупил ещё ключей". Коды — сгенерированные
// заглушки в том же формате, что и исходный пул задания, не настоящие ключи
// (у демонстрационного магазина настоящих и не бывает).
function restock(sku, count) {
  if (!getProduct.get(sku)) {
    const err = new Error(`Неизвестный sku: ${sku}`);
    err.status = 400;
    throw err;
  }
  const codes = [];
  for (let i = 0; i < count; i++) {
    const code = generateCode();
    insertKey.run(code, sku);
    codes.push(code);
  }
  return codes;
}

module.exports = { listStuckOrders, getStockLevels, restock };
