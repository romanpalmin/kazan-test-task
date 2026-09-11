// Общая точка для "остаток по SKU изменился" — вызывается из трёх мест,
// где keys_pool реально меняется (orderService.createOrder — резерв при
// создании, paymentService — освобождение резерва при payment_failed,
// adminService.restock — пополнение). Каждый вызывающий просто передаёт
// sku, не проверяя тип товара сам — единственное место, которое решает
// "стоит ли вообще транслировать остаток для этого SKU", здесь.
const db = require('../db/connection');
const { broadcast } = require('./eventBus');

const getType = db.prepare('SELECT type FROM products WHERE sku = ?');
const countFree = db.prepare('SELECT COUNT(*) c FROM keys_pool WHERE sku = ? AND order_id IS NULL');

function broadcastStock(sku) {
  const product = getType.get(sku);
  if (!product || product.type !== 'key') return; // нет реального пула — нечего транслировать
  const stock = countFree.get(sku).c;
  broadcast({ type: 'stock', sku, stock });
}

module.exports = { broadcastStock };
