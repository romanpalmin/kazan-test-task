const express = require('express');
const { listStuckOrders, getStockLevels, restock } = require('../services/adminService');
const { deliverKey } = require('../services/deliveryService');
const { findOrder } = require('../services/orderService');

const router = express.Router();

// Простой токен, не полноценная авторизация — задание прямо разрешает
// админку без авторизации или с простым токеном для неё. ADMIN_TOKEN
// из env; дефолт есть только ради локального запуска по README без
// лишней настройки, для реального прода такого дефолта быть не должно.
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'kazan-admin-dev';

router.use((req, res, next) => {
  if (req.get('X-Admin-Token') !== ADMIN_TOKEN) {
    return res.status(401).json({ error: 'Неверный или отсутствующий X-Admin-Token' });
  }
  next();
});

// Список "оплачен, но не выдан" — обе восстановимые ветки статус-машины.
router.get('/orders/stuck', (req, res) => {
  res.json(listStuckOrders());
});

router.get('/stock', (req, res) => {
  res.json(getStockLevels());
});

// "Закупка" ключей — генерирует count кодов-заглушек для sku и кладёт их
// в свободный пул. Единственный способ восстановить sku из out_of_stock
// без ручного SQL.
router.post('/keys/restock', (req, res) => {
  const { sku, count } = req.body;
  const n = Number(count);
  if (typeof sku !== 'string' || !sku || !Number.isInteger(n) || n < 1 || n > 1000) {
    return res.status(400).json({ error: 'sku (строка) и count (целое 1..1000) обязательны' });
  }
  try {
    const codes = restock(sku, n);
    res.status(201).json({ sku, added: codes.length, stock: getStockLevels() });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Ручной повтор выдачи — идемпотентен тем же CAS-гвардом, что и
// автоматическая доставка после оплаты (см.
// deliveryService.claimForDelivery). Если заказ уже не в
// paid/out_of_stock/delivery_failed — deliverKey тихо ничего не делает,
// ручка всё равно отвечает 200 с текущим состоянием заказа: повторный
// клик по кнопке "Повторить" не ломает и не задваивает.
router.post('/orders/:id/retry', async (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });

  try {
    await deliverKey(req.params.id);
  } catch (err) {
    console.error(`Ручной повтор упал для заказа ${req.params.id}:`, err);
    return res.status(500).json({ error: 'Повтор выдачи упал, см. логи сервера' });
  }

  res.json(findOrder(req.params.id));
});

module.exports = router;
