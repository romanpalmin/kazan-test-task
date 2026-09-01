-- Таблица товаров (каталог) — статика из docs/task-conditions.md, сидируется при старте.
CREATE TABLE IF NOT EXISTS products (
  sku      TEXT PRIMARY KEY,
  name     TEXT NOT NULL,
  type     TEXT NOT NULL,
  price    INTEGER NOT NULL,
  currency TEXT NOT NULL,
  image    TEXT
);

-- Заказы — состояние из docs/task-conditions.md "Статусы заказа".
CREATE TABLE IF NOT EXISTS orders (
  id                TEXT PRIMARY KEY,
  sku               TEXT NOT NULL REFERENCES products(sku),
  status            TEXT NOT NULL DEFAULT 'created',
  issued_code       TEXT,
  issue_request_id  TEXT,
  created_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at        TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Пул ключей для выдачи. Один ключ — один заказ: как только ключ привязан
-- к заказу (order_id NOT NULL), он больше не участвует в выборке свободных.
CREATE TABLE IF NOT EXISTS keys_pool (
  code     TEXT PRIMARY KEY,
  sku      TEXT NOT NULL REFERENCES products(sku),
  order_id TEXT REFERENCES orders(id)
);

-- Дедупликация вебхуков оплаты. Ключевая таблица под Этап 2 (гонки).
--
-- Механизм однократной обработки: перед тем как что-либо менять по заказу,
-- вставляем строку с PRIMARY KEY = event_id. SQLite гарантирует, что при
-- параллельных INSERT с одинаковым event_id ровно одна транзакция получит
-- успех, остальные — constraint violation (ON CONFLICT DO NOTHING → 0 строк
-- вставлено). "Кто вставил — тот и обрабатывает" — без отдельной блокировки
-- и без окна между "проверить" и "записать" (check-then-act race не может
-- возникнуть, потому что проверка и запись — одна атомарная операция).
CREATE TABLE IF NOT EXISTS processed_webhook_events (
  event_id     TEXT PRIMARY KEY,
  order_id     TEXT NOT NULL,
  processed_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_keys_pool_free ON keys_pool (sku) WHERE order_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders (status);

-- Платёж, полученный до/без соответствующего заказа (вебхук пришёл раньше
-- создания заказа или не по порядку). Тот же паттерн атомарного INSERT-как-
-- шлюза, что у processed_webhook_events, но ключ — order_id: это "последний
-- известный факт оплаты по заказу, который ещё не применён". Создание
-- заказа проверяет эту таблицу и сразу применяет запаркованный платёж —
-- без опроса/фоновой задачи.
CREATE TABLE IF NOT EXISTS pending_payments (
  order_id    TEXT PRIMARY KEY,
  status      TEXT NOT NULL, -- 'paid' | 'payment_failed'
  event_id    TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- Идемпотентность на стороне поставщика выдачи — не путать с
-- processed_webhook_events (та про вебхуки платёжки, эта про контракт
-- "поставщик кода"). Проверяется ПЕРВЫМ шагом при любом обращении к
-- поставщику, до розыгрыша ошибки/таймаута. Это и есть защита от "ловушки
-- таймаута": если поставщик уже выдал код на этот request_id (даже если
-- наш клиент не дождался ответа в тот раз), повтор просто вернёт тот же
-- code, не трогая пул ключей повторно.
CREATE TABLE IF NOT EXISTS issuer_ledger (
  request_id TEXT PRIMARY KEY,
  code       TEXT NOT NULL,
  order_id   TEXT NOT NULL REFERENCES orders(id),
  provider   TEXT NOT NULL
);
