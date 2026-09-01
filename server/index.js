const path = require('path');
const express = require('express');

const ordersRouter = require('./routes/orders');
const webhookRouter = require('./routes/webhook');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/orders', ordersRouter);
app.use('/webhook', webhookRouter);

app.listen(PORT, () => {
  console.log(`Сервер запущен: http://localhost:${PORT}`);
});
