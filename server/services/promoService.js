const db = require('../db/connection');

const now = "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const getOrder = db.prepare('SELECT * FROM orders WHERE id = ?');
const getProduct = db.prepare('SELECT price, currency FROM products WHERE sku = ?');
const getPromo = db.prepare('SELECT * FROM promocodes WHERE code = ?');

// Единственный по-настоящему load-bearing гвард во всей функции ниже —
// именно этот UPDATE решает "лимит N под параллельными запросами"
// (acceptance criterion #5 задания). changes===0 значит лимит уже
// исчерпан кем-то другим прямо сейчас — тот же класс атомарного
// "занять единицу ограниченного ресурса", что и claimKey в
// issuerService.js, только ресурс — не ключ, а место в лимите.
const claimUse = db.prepare(
  'UPDATE promocodes SET used_count = used_count + 1 WHERE code = ? AND used_count < max_uses'
);

// WHERE status='created' здесь избыточен по построению: вся функция
// applyPromo — одна db.transaction(), а better-sqlite3 требует, чтобы
// её тело было строго синхронным (без await) — значит между чтением
// order в начале и этим UPDATE в конце физически не может выполниться
// ни одна строчка другого запроса (тот же однопоточный синхронный
// аргумент, что в connection.js про WAL). Guard оставлен ради
// единообразия со стилем остального проекта ("каждый мутирующий UPDATE
// сам себе guard") и defense-in-depth на случай, если кто-то в будущем
// вынесет часть логики из транзакции — не как единственная линия
// защиты.
const setOrderPromo = db.prepare(
  `UPDATE orders SET promo_code = ?, discount_amount = ?, updated_at = ${now}
   WHERE id = ? AND status = 'created'`
);

function computeDiscount(promo, price) {
  const raw = promo.type === 'percent' ? Math.round((price * promo.value) / 100) : promo.value;
  return Math.min(raw, price); // не уходим в минус
}

/**
 * Применить промокод к заказу. Одна атомарная транзакция — см.
 * комментарий у setOrderPromo про то, почему это безопасно под
 * гонкой без отдельных блокировок. Идемпотентна: повторный вызов с
 * ТЕМ ЖЕ кодом на заказ, где он уже применён, не трогает used_count
 * повторно (иначе двойной клик "Применить" на фронте потихоньку ел бы
 * лимит) — возвращает уже посчитанный результат.
 */
const applyPromo = db.transaction((orderId, code) => {
  const order = getOrder.get(orderId);
  if (!order) {
    const err = new Error('Заказ не найден');
    err.status = 404;
    throw err;
  }

  if (order.promo_code) {
    if (order.promo_code === code) {
      const product = getProduct.get(order.sku);
      return {
        code: order.promo_code,
        discountAmount: order.discount_amount,
        finalPrice: product.price - order.discount_amount,
        currency: product.currency,
        replay: true,
      };
    }
    const err = new Error('На заказ уже применён другой промокод');
    err.status = 409;
    throw err;
  }

  if (order.status !== 'created') {
    const err = new Error('Заказ уже не ожидает оплаты — промокод неприменим');
    err.status = 409;
    throw err;
  }

  const promo = getPromo.get(code);
  if (!promo) {
    const err = new Error('Неверный промокод');
    err.status = 400;
    throw err;
  }

  const claimed = claimUse.run(code);
  if (claimed.changes === 0) {
    const err = new Error('Промокод исчерпан');
    err.status = 409;
    throw err;
  }

  const product = getProduct.get(order.sku);
  const discountAmount = computeDiscount(promo, product.price);
  setOrderPromo.run(promo.code, discountAmount, orderId);

  return {
    code: promo.code,
    discountAmount,
    finalPrice: product.price - discountAmount,
    currency: product.currency,
  };
});

module.exports = { applyPromo };
