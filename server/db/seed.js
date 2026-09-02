const db = require('./connection');
const products = require('./seed-data/products.json');
const keys = require('./seed-data/keys.json');
const promocodes = require('./seed-data/promocodes.json');

// Пул ключей в задании — плоский список без привязки к товару. Задание
// прямо разрешает: "рабочий флоу покупки достаточно сделать для одного
// товара" — весь пул отдаём одному товару, остальные видны в каталоге,
// но без рабочей выдачи.
const DEMO_SKU = 'KEY-CS2-PRIME';

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
  for (const code of keys) insertKey.run(code, DEMO_SKU);
  for (const promo of promocodes) insertPromo.run(promo);
});

seed();

console.log(
  `Сидирование готово: ${products.length} товаров, ${keys.length} ключей → ${DEMO_SKU}, ${promocodes.length} промокодов`
);
