const express = require('express');
const db = require('../db/connection');

const router = express.Router();
// GEN- — префикс синтетических товаров бонуса 5 (см.
// seed-data/generate-synthetic-products.js). Основная витрина
// (без q/type) не должна внезапно раздуться до тысяч строк только
// потому, что в products появились ещё тысячи записей — она по-прежнему
// показывает только настоящие 12 из условия задания, ровно как до
// бонуса 5. Синтетика видна исключительно через поиск/фильтр ниже.
const getAll = db.prepare(`
  SELECT sku, name, type, price, currency, image FROM products WHERE sku NOT LIKE 'GEN-%'
`);
const getStock = db.prepare(`
  SELECT sku, COUNT(*) AS stock FROM keys_pool WHERE order_id IS NULL GROUP BY sku
`);

// stock: число — только для type='key' (реальный пул есть, задача 2/1);
// null — для остальных SKU (пула нет вообще, "остаток" для них не
// имеет смысла, а не "0 и распродано"). Фронтенд использует null как
// сигнал "не показывать остаток и не гасить кнопку по нему". Общая для
// обоих режимов ниже (весь каталог и поиск) — синтетические товары
// бонуса 5 проходят через неё точно так же, как настоящие 12.
function withStock(products) {
  const stockBySku = Object.fromEntries(getStock.all().map((r) => [r.sku, r.stock]));
  return products.map((p) => ({ ...p, stock: p.type === 'key' ? (stockBySku[p.sku] ?? 0) : null }));
}

// Этап 2, бонус 5: поиск/фильтр по каталогу (тысячи синтетических товаров
// поверх настоящих 12, см. server/db/seed-data/generate-synthetic-products.js).
// lower_unicode — зарегистрирована в connection.js: встроенные LOWER()/LIKE
// SQLite регистронезависимы только для ASCII, кириллицу сравнивают
// побайтово ("Пополнение" ≠ "пополнение" для них) — JS `.toLowerCase()`
// кириллицу понимает правильно, поэтому сравниваем строки уже приведённые
// им к нижнему регистру, внутри самого SQL, не вытаскивая весь каталог в
// JS ради сравнения.
const VALID_TYPES = new Set(['key', 'topup', 'subscription', 'giftcard']);
const DEFAULT_LIMIT = 60;
const MAX_LIMIT = 100;

// % и _ — спецсимволы LIKE; без экранирования пользовательский ввод
// "50%" сработал бы как маска "50" + что угодно, а не буквальный текст.
function escapeLike(value) {
  return value.replace(/[%_\\]/g, '\\$&');
}

const searchCount = db.prepare(`
  SELECT COUNT(*) AS c FROM products
  WHERE (@q IS NULL OR lower_unicode(name) LIKE '%' || lower_unicode(@q) || '%' ESCAPE '\\')
    AND (@type IS NULL OR type = @type)
`);
const searchRows = db.prepare(`
  SELECT sku, name, type, price, currency, image FROM products
  WHERE (@q IS NULL OR lower_unicode(name) LIKE '%' || lower_unicode(@q) || '%' ESCAPE '\\')
    AND (@type IS NULL OR type = @type)
  ORDER BY name
  LIMIT @limit
`);

router.get('/', (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const type = typeof req.query.type === 'string' ? req.query.type : '';

  // Без q и без type — прежнее поведение без изменений: весь (настоящий,
  // маленький) каталог целиком, как и до бонуса 5. Синтетические тысячи
  // сюда не попадают — они существуют только ради поиска, не ради
  // основной витрины.
  if (!q && !type) {
    return res.json(withStock(getAll.all()));
  }

  if (type && !VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `Неизвестный type: ${type}` });
  }
  const limitRaw = parseInt(req.query.limit, 10);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number.isNaN(limitRaw) ? DEFAULT_LIMIT : limitRaw));

  const params = { q: q ? escapeLike(q) : null, type: type || null, limit };
  const total = searchCount.get(params).c;
  const results = withStock(searchRows.all(params));
  res.json({ results, total, limit });
});

module.exports = router;
