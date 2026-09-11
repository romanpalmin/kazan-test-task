const express = require('express');
const { subscribe, unsubscribe } = require('../services/eventBus');

const router = express.Router();

// Server-Sent Events — один долгоживущий GET, сервер пишет в него по мере
// событий, соединение никогда не закрывается сам сервером. Браузерный
// EventSource на клиенте (public/js/app.js) сам переподключается при
// обрыве — этим и закрыт пункт задания "переживает обрыв связи", без
// ручной логики реконнекта здесь или там.
router.get('/', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  res.write('\n'); // открыть поток сразу — иначе EventSource не считает соединение установленным до первого байта

  subscribe(res);
  req.on('close', () => unsubscribe(res));
});

module.exports = router;
