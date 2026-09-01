const express = require('express');
const db = require('../db/connection');

const router = express.Router();
const getAll = db.prepare('SELECT sku, name, type, price, currency, image FROM products');

router.get('/', (req, res) => {
  res.json(getAll.all());
});

module.exports = router;
