#!/usr/bin/env node
'use strict';

// Способ воспроизвести проверку гонок (задание, "Приложите способ
// воспроизвести скрипт/тест с параллельными запросами" — Этап 2 — и
// "применён не более N раз" — Этап 4). Сам поднимает сервер на
// отдельном порту, сбрасывает БД в чистое состояние, гоняет несколько
// сценариев и проверяет результат прямым чтением SQLite-файла — не
// нужно вручную поднимать сервер в соседнем терминале.
//
// Запуск: npm run test:race

const { spawn, execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');
const PORT = process.env.RACE_TEST_PORT || '3999';
const BASE_URL = `http://localhost:${PORT}`;

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const DIM = '\x1b[2m';
const RESET = '\x1b[0m';

const results = [];
function check(label, ok, detail) {
  results.push({ label, ok });
  const mark = ok ? `${GREEN}✓${RESET}` : `${RED}✗${RESET}`;
  console.log(`  ${mark} ${label}${detail ? ` ${DIM}(${detail})${RESET}` : ''}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function createOrder() {
  const r = await fetch(`${BASE_URL}/orders`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sku: 'KEY-CS2-PRIME' }),
  });
  return r.json();
}

async function getOrder(id) {
  const r = await fetch(`${BASE_URL}/orders/${id}`);
  return r.json();
}

async function sendWebhook(eventId, orderId, status = 'paid') {
  const r = await fetch(`${BASE_URL}/webhook/payment`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event_id: eventId,
      order_id: orderId,
      status,
      amount: 1290,
      currency: 'RUB',
      created_at: new Date().toISOString(),
    }),
  });
  return r.json();
}

async function applyPromo(orderId, code) {
  const r = await fetch(`${BASE_URL}/orders/${orderId}/promo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code }),
  });
  return { status: r.status, body: await r.json() };
}

async function waitForServer(retries = 50) {
  for (let i = 0; i < retries; i++) {
    try {
      await fetch(`${BASE_URL}/orders/ping`);
      return;
    } catch {
      await sleep(100);
    }
  }
  throw new Error('Сервер не поднялся за отведённое время');
}

async function scenarioSameEventId(db) {
  console.log('\nСценарий 1 — 50 параллельных вебхуков, ОДИН event_id (двойной клик / ретраи платёжки)');
  const order = await createOrder();
  const responses = await Promise.all(
    Array.from({ length: 50 }, () => sendWebhook('evt_race_same', order.id))
  );
  await sleep(300); // дать фоновой (fire-and-forget) доставке завершиться

  const final = await getOrder(order.id);
  const nonDuplicate = responses.filter((r) => !r.duplicate).length;
  const keysClaimed = db.prepare('SELECT COUNT(*) c FROM keys_pool WHERE order_id = ?').get(order.id).c;

  check('ровно 1 ответ без duplicate:true', nonDuplicate === 1, `получено ${nonDuplicate}`);
  check('ровно 1 ключ привязан к заказу', keysClaimed === 1, `получено ${keysClaimed}`);
  check('заказ доставлен (delivered)', final.status === 'delivered', `статус: ${final.status}`);
}

async function scenarioDifferentEventIds(db) {
  console.log('\nСценарий 2 — 50 параллельных вебхуков, 50 РАЗНЫХ event_id на один заказ');
  const order = await createOrder();
  await Promise.all(
    Array.from({ length: 50 }, (_, i) => sendWebhook(`evt_race_multi_${i}`, order.id))
  );
  await sleep(300);

  const final = await getOrder(order.id);
  const keysClaimed = db.prepare('SELECT COUNT(*) c FROM keys_pool WHERE order_id = ?').get(order.id).c;
  const eventsRecorded = db
    .prepare('SELECT COUNT(*) c FROM processed_webhook_events WHERE order_id = ?')
    .get(order.id).c;

  check('ровно 1 ключ привязан к заказу (спасает CAS статуса, не дедуп по event_id)', keysClaimed === 1, `получено ${keysClaimed}`);
  check('заказ доставлен (delivered)', final.status === 'delivered', `статус: ${final.status}`);
  check('все 50 разных событий записаны как обработанные', eventsRecorded === 50, `получено ${eventsRecorded}`);
}

async function scenarioPromoLimit(db) {
  console.log('\nСценарий 4 — промокод с лимитом 3 (LIMIT3), 10 параллельных заказов пытаются его применить');
  const orders = await Promise.all(Array.from({ length: 10 }, () => createOrder()));
  const results = await Promise.all(orders.map((o) => applyPromo(o.id, 'LIMIT3')));

  const succeeded = results.filter((r) => r.status === 200).length;
  const usedCount = db.prepare('SELECT used_count FROM promocodes WHERE code = ?').get('LIMIT3').used_count;
  const ordersWithPromo = db.prepare("SELECT COUNT(*) c FROM orders WHERE promo_code = 'LIMIT3'").get().c;

  check('ровно 3 из 10 параллельных запросов приняты', succeeded === 3, `получено ${succeeded}`);
  check('used_count в promocodes равен 3 (не больше, не меньше)', usedCount === 3, `получено ${usedCount}`);
  check('ровно 3 заказа помечены этим промокодом', ordersWithPromo === 3, `получено ${ordersWithPromo}`);
}

async function scenarioPromoOnce(db) {
  console.log('\nСценарий 4b — предельный случай N=1 (ONCEONLY), 5 параллельных заказов');
  const orders = await Promise.all(Array.from({ length: 5 }, () => createOrder()));
  const results = await Promise.all(orders.map((o) => applyPromo(o.id, 'ONCEONLY')));

  const succeeded = results.filter((r) => r.status === 200).length;
  const usedCount = db.prepare('SELECT used_count FROM promocodes WHERE code = ?').get('ONCEONLY').used_count;

  check('ровно 1 из 5 параллельных запросов принят', succeeded === 1, `получено ${succeeded}`);
  check('used_count в promocodes равен 1', usedCount === 1, `получено ${usedCount}`);
}

async function scenarioPromoReleaseOnPaymentFailed(db) {
  console.log('\nСценарий 4c — промокод освобождается при payment_failed, но не при out_of_stock/delivery_failed');
  const before = db.prepare('SELECT used_count FROM promocodes WHERE code = ?').get('WELCOME10').used_count;

  const orderA = await createOrder();
  await applyPromo(orderA.id, 'WELCOME10');
  await sendWebhook('evt_release_a', orderA.id, 'failed');
  await sleep(100);

  const afterFail = db.prepare('SELECT used_count FROM promocodes WHERE code = ?').get('WELCOME10').used_count;
  const orderARow = db.prepare('SELECT status, promo_code FROM orders WHERE id = ?').get(orderA.id);

  check('заказ ушёл в payment_failed', orderARow.status === 'payment_failed', `статус: ${orderARow.status}`);
  check(
    'promo_code остался на заказе как исторический факт (не стёрт)',
    orderARow.promo_code === 'WELCOME10'
  );
  check(
    'used_count вернулся к значению ДО применения (слот освобождён)',
    afterFail === before,
    `было ${before}, стало ${afterFail}`
  );

  // Тот же код должен снова успешно примениться другим заказом — слот
  // реально свободен, а не просто "выглядит как до".
  const orderB = await createOrder();
  const reapply = await applyPromo(orderB.id, 'WELCOME10');
  const afterReapply = db.prepare('SELECT used_count FROM promocodes WHERE code = ?').get('WELCOME10').used_count;

  check('тот же промокод повторно применяется другим заказом', reapply.status === 200, `код ${reapply.status}`);
  check('used_count после повторного применения снова +1 от before', afterReapply === before + 1, `получено ${afterReapply}`);
}

/**
 * Сценарий 3 проверяется НЕ через HTTP к поднятому серверу, а прямым
 * вызовом того же кода, который вызывает POST /webhook/payment.
 *
 * Почему: order_id генерирует сервер (случайный UUID) в момент создания
 * заказа — снаружи невозможно заранее знать id ещё не созданного заказа,
 * чтобы честно воспроизвести гонку через чистый HTTP (для этого
 * пришлось бы разрешить клиенту передавать свой id в POST /orders —
 * правка публичного API ради одного тестового сценария, которая не
 * нужна для остальной системы).
 *
 * paymentService.applyPayment/parkPayment/drainPendingPayment — ровно
 * тот код, который вызывает webhook.js, с реальной БД и реальными
 * транзакциями, ничего не замокано. HTTP-обёртка (распарсить тело →
 * вызвать сервис → сформировать ответ) не добавляет никаких гарантий
 * к этой логике — сокращена только точка входа.
 */
async function scenarioWebhookBeforeOrder() {
  console.log('\nСценарий 3 — вебхук приходит раньше, чем создан заказ');
  const writableDb = require('../server/db/connection');
  const paymentService = require('../server/services/paymentService');
  const { deliverKey } = require('../server/services/deliveryService');

  const ghostId = `ord_race_ghost_${Date.now()}`;

  const appliedEarly = paymentService.applyPayment(ghostId, 'paid');
  check('оплата не применилась к несуществующему заказу', appliedEarly === null);

  if (!paymentService.orderExists(ghostId)) {
    paymentService.parkPayment(ghostId, 'paid', `evt_ghost_${Date.now()}`);
  }
  const parked = writableDb.prepare('SELECT * FROM pending_payments WHERE order_id = ?').get(ghostId);
  check('платёж запаркован', Boolean(parked));

  // Эмулируем момент создания заказа с этим же id — в реальном флоу это
  // делает orderService.createOrder со случайным id; здесь id известен
  // заранее специально для теста, поэтому это прямая вставка, а не HTTP.
  writableDb.prepare("INSERT INTO orders (id, sku, status) VALUES (?, 'KEY-CS2-PRIME', 'created')").run(ghostId);
  const applied = paymentService.drainPendingPayment(ghostId);
  if (applied === 'paid') await deliverKey(ghostId);

  const final = writableDb.prepare('SELECT status, issued_code FROM orders WHERE id = ?').get(ghostId);
  check(
    'запаркованный платёж применён и заказ доставлен без опроса',
    final.status === 'delivered' && Boolean(final.issued_code),
    `статус: ${final.status}`
  );
}

async function main() {
  console.log('Сброс БД в чистое сидированное состояние...');
  for (const suffix of ['', '-wal', '-shm']) {
    fs.rmSync(path.join(ROOT, 'data', `app.db${suffix}`), { force: true });
  }
  execSync('npm run seed', { cwd: ROOT, stdio: 'ignore' });

  console.log(`Стартуем сервер на порту ${PORT} (шум поставщика выключен — детерминированные сценарии)...`);
  const server = spawn('node', ['server/index.js'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT,
      ISSUER_A_FAILURE_RATE: '0',
      ISSUER_A_TIMEOUT_RATE: '0',
      ISSUER_B_FAILURE_RATE: '0',
      ISSUER_B_TIMEOUT_RATE: '0',
      ISSUER_DELAY_MS: '5',
    },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  process.on('exit', () => server.kill());

  try {
    await waitForServer();

    const Database = require('better-sqlite3');
    const db = new Database(path.join(ROOT, 'data', 'app.db'), { readonly: true });

    await scenarioSameEventId(db);
    await scenarioDifferentEventIds(db);
    await scenarioPromoLimit(db);
    await scenarioPromoOnce(db);
    await scenarioPromoReleaseOnPaymentFailed(db);
    db.close();

    await scenarioWebhookBeforeOrder();
  } finally {
    server.kill();
  }

  const failed = results.filter((r) => !r.ok);
  const color = failed.length === 0 ? GREEN : RED;
  console.log(`\n${color}${results.length - failed.length}/${results.length} проверок пройдено${RESET}`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('race-test упал с ошибкой:', err);
  process.exit(1);
});
