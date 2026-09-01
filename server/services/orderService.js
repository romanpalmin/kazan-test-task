const crypto = require('crypto');
const db = require('../db/connection');

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
  return getOrder.get(id);
}

function findOrder(id) {
  return getOrder.get(id);
}

module.exports = { createOrder, findOrder };
