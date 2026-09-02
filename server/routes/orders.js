const express = require('express');
const { createOrder, findOrder, listOrders } = require('../services/orderService');

const router = express.Router();

// Список заказов для попапа "История" (клик по иконке профиля) —
// покупка/заказ/результат по просьбе заказчика, уточнение вне
// docs/task-conditions.md.
router.get('/', (req, res) => {
  res.json(listOrders());
});

// Создать заказ. Флоу начинается с кнопки "Купить" на карточке товара.
router.post('/', (req, res) => {
  const { sku } = req.body;
  if (typeof sku !== 'string' || !sku) {
    return res.status(400).json({ error: 'sku обязателен' });
  }
  try {
    const order = createOrder(sku);
    res.status(201).json(order);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

// Статус заказа — то, что покажет страница статуса.
router.get('/:id', (req, res) => {
  const order = findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: 'Заказ не найден' });
  res.json(order);
});

module.exports = router;
