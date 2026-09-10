const db = require('./connection');
const products = require('./seed-data/products.json');
const keysBySku = require('./seed-data/keys.json');
const promocodes = require('./seed-data/promocodes.json');

// Пул ключей — по SKU. Задание разрешает ограничиться рабочей выдачей для
// одного товара, но не одним — Этап 2 (гонки/живой остаток/бронь) нуждается
// в SKU с малым остатком: KEY-GTA5 (ровно 1 ключ — гонка за последнюю
// единицу), KEY-EFT (3 ключа — демо живого списания остатка/брони). Остальные
// товары каталога по-прежнему без пула (недоступны для реальной выдачи).

const insertProduct = db.prepare(`
  INSERT OR IGNORE INTO products (sku, name, type, price, currency, image)
  VALUES (@sku, @name, @type, @price, @currency, @image)
`);

const insertKey = db.prepare(`
  INSERT OR IGNORE INTO keys_pool (code, sku, order_id)
  VALUES (?, ?, NULL)
`);

const insertPromo = db.prepare(`
  INSERT OR IGNORE INTO promocodes (code, type, value, max_uses)
  VALUES (@code, @type, @value, @max_uses)
`);

const seed = db.transaction(() => {
  for (const product of products) insertProduct.run(product);
  for (const [sku, codes] of Object.entries(keysBySku)) {
    for (const code of codes) insertKey.run(code, sku);
  }
  for (const promo of promocodes) insertPromo.run(promo);
});

seed();

const totalKeys = Object.values(keysBySku).reduce((sum, codes) => sum + codes.length, 0);
const skuSummary = Object.entries(keysBySku)
  .map(([sku, codes]) => `${sku}:${codes.length}`)
  .join(', ');

console.log(
  `Сидирование готово: ${products.length} товаров, ${totalKeys} ключей (${skuSummary}), ${promocodes.length} промокодов`
);
