// Этап 2, задача 1 (живая витрина). Простейший in-memory pub/sub — один
// процесс Node, один файл SQLite, никакого Redis/брокера не нужно: все
// подписчики (открытые вкладки браузера) живут в памяти этого же
// процесса. Если бы приложение работало на нескольких процессах/машинах,
// этот модуль перестал бы быть достаточным (вкладка, подключённая к
// процессу A, не узнала бы о событии, вызванном на процессе B) — но для
// одного `node server/index.js` за nginx это ровно то допущение, что уже
// сделано для SQLite-файла (см. connection.js).
const clients = new Set();

function subscribe(res) {
  clients.add(res);
}

function unsubscribe(res) {
  clients.delete(res);
}

// Формат SSE: событие — это "data: <JSON>\n\n" (пустая строка обязательна,
// это и есть разделитель сообщений в протоколе). Пишем в каждый открытый
// response напрямую — если какой-то клиент уже отвалился и write() упадёт,
// оборачивать в try не нужно: unsubscribe произойдёт по req.on('close', ...)
// в routes/events.js раньше, чем сюда долетит следующий broadcast.
function broadcast(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) {
    res.write(payload);
  }
}

module.exports = { subscribe, unsubscribe, broadcast };
