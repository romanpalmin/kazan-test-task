const db = require('../db/connection');

// Доли ошибок/таймаутов — настраиваемые (задание явно просит), через env,
// чтобы race-test.js и ручное тестирование Этапа 3 могли их менять без
// правки кода. Оба поставщика читают из ОДНОГО локального keys_pool —
// упрощение: в реальности у каждого поставщика было бы своё независимое
// хранилище, но для проверки самой механики идемпотентности и fallback
// это не требуется, а тестировать так сильно проще.
const RATES = {
  A: {
    failureRate: parseFloat(process.env.ISSUER_A_FAILURE_RATE ?? '0.1'),
    timeoutRate: parseFloat(process.env.ISSUER_A_TIMEOUT_RATE ?? '0.1'),
  },
  B: {
    failureRate: parseFloat(process.env.ISSUER_B_FAILURE_RATE ?? '0.1'),
    timeoutRate: parseFloat(process.env.ISSUER_B_TIMEOUT_RATE ?? '0.1'),
  },
};

const ARTIFICIAL_DELAY_MS = parseInt(process.env.ISSUER_DELAY_MS ?? '30', 10);

const getLedger = db.prepare('SELECT code FROM issuer_ledger WHERE request_id = ?');
const insertLedger = db.prepare(`
  INSERT INTO issuer_ledger (request_id, code, order_id, provider) VALUES (?, ?, ?, ?)
`);
const claimKey = db.prepare(`
  UPDATE keys_pool
  SET order_id = ?
  WHERE code = (SELECT code FROM keys_pool WHERE sku = ? AND order_id IS NULL LIMIT 1)
    AND order_id IS NULL
`);
const getClaimedCode = db.prepare('SELECT code FROM keys_pool WHERE order_id = ?');

// Атомарно: занять свободный ключ под этот заказ (если ещё не занят) и
// зафиксировать его в леджере под этим request_id. Один db.transaction —
// либо всё, либо ничего, даже если бы это была многоконнекшенная СУБД.
const claimAndRecord = db.transaction((requestId, sku, orderId, provider) => {
  claimKey.run(orderId, sku);
  const row = getClaimedCode.get(orderId);
  if (!row) return null; // пул пуст
  insertLedger.run(requestId, row.code, orderId, provider);
  return row.code;
});

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Симуляция обращения к внешнему поставщику кодов (контракт "POST /issue"
 * из задания). request_id — ключ идемпотентности: повтор с тем же
 * request_id обязан вернуть тот же code, таймаут ≠ отказ.
 */
async function issue({ requestId, sku, orderId, provider }) {
  // Шаг 1, ВСЕГДА первый, до розыгрыша рандома ниже: если этот request_id
  // уже выдавал код — вернуть его. Это единственное место, которое решает
  // "ловушку таймаута" — при повторе мы сюда попадаем и рандом ниже уже
  // не участвует.
  const existing = getLedger.get(requestId);
  if (existing) {
    await delay(ARTIFICIAL_DELAY_MS);
    return { ok: true, code: existing.code, replay: true };
  }

  const rates = RATES[provider];
  const roll = Math.random();

  if (roll < rates.failureRate) {
    await delay(ARTIFICIAL_DELAY_MS);
    return { ok: false, reason: 'provider_error', retriable: true };
  }

  const isTimeout = roll < rates.failureRate + rates.timeoutRate;

  // Поставщик в обоих случаях (успех и "таймаут") реально выполняет
  // выдачу — разница только в том, доходит ли ответ до нас.
  const code = claimAndRecord(requestId, sku, orderId, provider);

  if (!code) {
    await delay(ARTIFICIAL_DELAY_MS);
    return { ok: false, reason: 'out_of_stock', retriable: false };
  }

  if (isTimeout) {
    // Ключ уже выдан и записан в issuer_ledger — но "ответ теряется".
    // Следующий вызов с тем же request_id найдёт его на шаге 1.
    await delay(ARTIFICIAL_DELAY_MS * 4);
    return { ok: false, reason: 'timeout', retriable: true };
  }

  await delay(ARTIFICIAL_DELAY_MS);
  return { ok: true, code, replay: false };
}

module.exports = { issue };
