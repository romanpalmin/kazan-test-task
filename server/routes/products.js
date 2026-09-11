const express = require('express');
const db = require('../db/connection');

const router = express.Router();
const getAll = db.prepare('SELECT sku, name, type, price, currency, image FROM products');
const getStock = db.prepare(`
  SELECT sku, COUNT(*) AS stock FROM keys_pool WHERE order_id IS NULL GROUP BY sku
`);

// stock: число — только для type='key' (реальный пул есть, задача 2/1);
// null — для остальных 9 SKU (пула нет вообще, "остаток" для них не
// имеет смысла, а не "0 и распродано"). Фронтенд использует null как
// сигнал "не показывать остаток и не гасить кнопку по нему".
router.get('/', (req, res) => {
  const products = getAll.all();
  const stockBySku = Object.fromEntries(getStock.all().map((r) => [r.sku, r.stock]));
  res.json(
    products.map((p) => ({ ...p, stock: p.type === 'key' ? (stockBySku[p.sku] ?? 0) : null }))
  );
});

module.exports = router;
