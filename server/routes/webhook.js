const express = require('express');
const db = require('../db/connection');
const { applyPayment, orderExists, parkPayment } = require('../services/paymentService');
const { deliverKey } = require('../services/deliveryService');

const router = express.Router();

// Шаг 1 (дедуп): сама вставка — шлюз. При параллельных вебхуках с одним
// event_id ровно один INSERT пройдёт, остальные увидят changes===0.
const insertProcessedEvent = db.prepare(
  'INSERT OR IGNORE INTO processed_webhook_events (event_id, order_id) VALUES (?, ?)'
);

router.post('/payment', (req, res) => {
  const { event_id, order_id, status } = req.body || {};

  const validStatus = status === 'paid' || status === 'failed';
  if (typeof event_id !== 'string' || !event_id || typeof order_id !== 'string' || !order_id || !validStatus) {
    return res.status(400).json({ error: 'event_id, order_id и status (paid|failed) обязательны' });
  }

  const dedup = insertProcessedEvent.run(event_id, order_id);
  if (dedup.changes === 0) {
    // Этот event_id уже обработан — повтор ничего не меняет.
    return res.status(200).json({ received: true, duplicate: true });
  }

  const normalizedStatus = status === 'paid' ? 'paid' : 'payment_failed';
  const applied = applyPayment(order_id, normalizedStatus);

  // Заказа ещё нет (вебхук пришёл раньше/не по порядку) — паркуем, не
  // теряем. Если заказ есть, но уже не в 'created' — это лишний поздний
  // вебхук на уже обработанный заказ, тоже штатно, просто no-op.
  if (!applied && !orderExists(order_id)) {
    parkPayment(order_id, normalizedStatus, event_id);
  }

  // Быстрый 200 — задание прямо просит: платёжка повторит доставку сама
  // при 5xx/таймауте, а сама выдача ключа может занять время (симуляция
  // задержки поставщика) и не должна держать вебхук.
  res.status(200).json({ received: true });

  if (applied === 'paid') {
    deliverKey(order_id).catch((err) => {
      console.error(`deliverKey упал для заказа ${order_id}:`, err);
    });
  }
});

module.exports = router;
