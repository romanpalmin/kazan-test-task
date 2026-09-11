// Этап 2, бонус 5 (поиск по каталогу тысяч позиций). Без q/type — прежнее
// поведение: весь маленький "настоящий" каталог, как было до бонуса 5.
async function loadDefaultCatalog() {
  const grid = document.getElementById('productGrid');
  document.getElementById('productsHeading').textContent = 'Популярные товары';
  try {
    const res = await fetch('products');
    const products = await res.json();
    grid.innerHTML = products.map(productCardHtml).join('');
  } catch (err) {
    grid.innerHTML = '<p class="product-grid-loading">Не удалось загрузить каталог.</p>';
    console.error(err);
  }
}

let currentSearch = { q: '', type: '' };
let searchAbortController = null;

async function runSearch() {
  const grid = document.getElementById('productGrid');
  const heading = document.getElementById('productsHeading');
  const { q, type } = currentSearch;

  // Отменяем предыдущий, ещё не ответивший запрос — без этого устаревший,
  // но медленно пришедший ответ на старый ввод мог бы перетереть на
  // экране результат более свежего, уже введённого запроса (условие
  // задачи требует именно это: "устаревшие ответы не перетирают свежие").
  if (searchAbortController) searchAbortController.abort();
  const controller = new AbortController();
  searchAbortController = controller;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('type', type);

  try {
    const res = await fetch(`products?${params.toString()}`, { signal: controller.signal });
    const data = await res.json();
    grid.innerHTML = data.results.length
      ? data.results.map(productCardHtml).join('')
      : '<p class="product-grid-loading">Ничего не найдено.</p>';
    heading.textContent = `Результаты поиска — показано ${data.results.length} из ${data.total}`;
  } catch (err) {
    if (err.name === 'AbortError') return; // отменили сами — новый запрос уже в пути, это не ошибка
    grid.innerHTML = '<p class="product-grid-loading">Не удалось выполнить поиск.</p>';
    console.error(err);
  }
}

// Общая точка входа — используется и при первой загрузке страницы, и при
// восстановлении SSE-соединения (см. initLiveUpdates): если в этот момент
// активен поиск, реконнект должен обновить ИМЕННО его, а не молча
// подменить экран на дефолтный каталог.
function refreshCatalog() {
  return currentSearch.q || currentSearch.type ? runSearch() : loadDefaultCatalog();
}

function readSearchStateFromUrl() {
  const params = new URLSearchParams(location.search);
  return { q: params.get('q') || '', type: params.get('type') || '' };
}

// replaceState, не pushState — фильтры сохраняются в URL (можно скопировать
// ссылку или обновить страницу без потери поиска), но история браузера не
// должна получать отдельную запись на каждую напечатанную букву.
function writeSearchStateToUrl({ q, type }) {
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (type) params.set('type', type);
  const qs = params.toString();
  history.replaceState(null, '', qs ? `${location.pathname}?${qs}` : location.pathname);
}

const SEARCH_DEBOUNCE_MS = 250;
let searchDebounceTimer = null;

function initSearch() {
  const input = document.getElementById('searchInput');
  const typeFilter = document.getElementById('searchTypeFilter');
  const submitBtn = document.getElementById('searchSubmitBtn');

  // Восстанавливаем состояние из URL при загрузке страницы — обновление
  // страницы или переход по скопированной ссылке не сбрасывает поиск.
  currentSearch = readSearchStateFromUrl();
  input.value = currentSearch.q;
  typeFilter.value = currentSearch.type;

  function searchNow() {
    clearTimeout(searchDebounceTimer);
    writeSearchStateToUrl(currentSearch);
    refreshCatalog();
  }

  input.addEventListener('input', () => {
    currentSearch.q = input.value.trim();
    // Debounce — не бить сервер на каждую нажатую клавишу, ждём паузы в
    // наборе текста.
    clearTimeout(searchDebounceTimer);
    searchDebounceTimer = setTimeout(searchNow, SEARCH_DEBOUNCE_MS);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') searchNow(); // не ждать паузы, если явно попросили
  });
  typeFilter.addEventListener('change', () => {
    currentSearch.type = typeFilter.value;
    searchNow(); // явный выбор из списка — не печать, debounce не нужен
  });
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    searchNow();
  });
}

const TYPE_ICON = { key: '🔑', topup: '💳', subscription: '⭐', giftcard: '🎁' };

function productCardHtml(product) {
  const icon = TYPE_ICON[product.type] || '🎮';
  const currency = currencySymbol(product.currency);
  // Старой цены нет в данных задания — чисто декоративная зачёркнутая
  // цена (x2 от текущей), как в макете. Решение Романа: задание не
  // запрещает, свобода в оформлении витрины.
  const oldPrice = product.price * 2;
  // stock: число только для type='key' (реальный пул есть — Этап 2,
  // задачи 1/2), null — для остальных 9 SKU (пула нет вообще, "0" был бы
  // ложью, что он раньше был и кончился). Строка остатка теперь рисуется
  // ВСЕГДА (даже при null — просто с текстом "Отсутствуют"), а не
  // условно: так у всех карточек одинаковое число строк, и цена всегда
  // оказывается на одной и той же линии по всему ряду — раньше, пока
  // строка остатка была то есть, то её не было, цена "гуляла" по высоте.
  // data-currency — чтобы applyLiveUpdate ниже могла дорисовать цену при
  // живом обновлении, не трогая остальную карточку и не гадая по уже
  // отрисованному тексту.
  const outOfStock = product.stock === 0;
  const stockText =
    product.stock === null ? 'Отсутствуют' : outOfStock ? 'Нет в наличии' : `Осталось: ${product.stock}`;
  // is-empty (красный, жирный) — только для реально распроданного (stock
  // === 0), это тревожное "раскупили только что" состояние. Для null
  // ("Отсутствуют" — учёта остатка для этого SKU просто нет и не было)
  // тот же красный цвет был бы вводящим в заблуждение: это не "срочно
  // кончилось", это факт про сам товар, обычный приглушённый стиль.
  const stockHtml = `<div class="product-card-stock${outOfStock ? ' is-empty' : ''}">${stockText}</div>`;
  return `
    <article class="product-card" data-sku="${product.sku}" data-currency="${product.currency}">
      <div class="product-card-thumb">
        <img class="thumb-img" src="${product.image}" alt="" />
        <span class="thumb-type-badge">${icon}</span>
      </div>
      <div class="product-card-meta">${icon} ${product.name}</div>
      <div class="product-card-price">
        <span class="price-now">${product.price} ${currency}</span>
        <span class="price-old">${oldPrice} ${currency}</span>
      </div>
      ${stockHtml}
      <button class="btn-primary buy-btn" data-sku="${product.sku}" ${outOfStock ? 'disabled' : ''}>${
        outOfStock ? 'Нет в наличии' : 'Купить'
      }</button>
    </article>
  `;
}

// Этап 2, задача 1 (живая витрина). Точечно обновляет уже отрисованную
// карточку по data-sku — не перерисовывает всю сетку целиком (без
// мигания, не сбрасывает состояние других открытых модалок/скролла).
// Если карточки с этим sku на странице нет (например, она с другого
// экрана каталога, которого сейчас нет) — событие просто игнорируется.
function applyLiveUpdate(msg) {
  const card = document.querySelector(`.product-card[data-sku="${CSS.escape(msg.sku)}"]`);
  if (!card) return;

  if (msg.type === 'stock') {
    const stockEl = card.querySelector('.product-card-stock');
    const btn = card.querySelector('.buy-btn');
    const outOfStock = msg.stock === 0;
    if (stockEl) {
      stockEl.textContent = outOfStock ? 'Нет в наличии' : `Осталось: ${msg.stock}`;
      stockEl.classList.toggle('is-empty', outOfStock);
    }
    if (btn) {
      btn.disabled = outOfStock;
      btn.textContent = outOfStock ? 'Нет в наличии' : 'Купить';
    }
  } else if (msg.type === 'price') {
    const currency = currencySymbol(card.dataset.currency);
    const priceNow = card.querySelector('.price-now');
    const priceOld = card.querySelector('.price-old');
    if (priceNow) priceNow.textContent = `${msg.price} ${currency}`;
    if (priceOld) priceOld.textContent = `${msg.price * 2} ${currency}`;
  }
}

// EventSource сам переподключается при обрыве связи (браузерная часть
// спецификации SSE) — здесь не нужна ручная логика реконнекта. На каждое
// (пере)подключение, включая самое первое, подтягиваем каталог целиком
// заново: сама SSE не хранит буфер пропущенных за время разрыва событий,
// а полный refetch — простой и надёжный способ не разъехаться с сервером
// после любого обрыва, а не только поймать events дальше по потоку.
function initLiveUpdates() {
  const es = new EventSource('events');
  es.onmessage = (e) => {
    try {
      applyLiveUpdate(JSON.parse(e.data));
    } catch (err) {
      console.error('Не удалось разобрать live-событие:', err);
    }
  };
  es.onopen = () => refreshCatalog(); // если активен поиск — обновит именно его, не молча подменит на дефолтный каталог
}

function currencySymbol(code) {
  return { RUB: '₽', USD: '$', KZT: '₸' }[code] || code;
}

function initCatalogMenu() {
  const toggle = document.getElementById('catalogToggle');
  const menu = document.getElementById('catalogMenu');
  const header = document.querySelector('.site-header');

  const open = () => {
    // top не хардкожен — шапка без фиксированной высоты, меню должно
    // встать ровно под ней при любой ширине экрана.
    menu.style.top = `${header.getBoundingClientRect().bottom}px`;
    menu.hidden = false;
    document.body.style.overflow = 'hidden';
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    menu.hidden = true;
    document.body.style.overflow = '';
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    menu.hidden ? open() : close();
  });
  // Клик вне меню закрывает — задание требует именно это, не только повторный клик по кнопке.
  document.addEventListener('click', (e) => {
    if (!menu.hidden && !menu.contains(e.target) && e.target !== toggle) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

function initCurrencySwitch() {
  const switcher = document.getElementById('currencySwitch');
  switcher.addEventListener('click', (e) => {
    const btn = e.target.closest('.currency-option');
    if (!btn) return;
    // Пересчёт суммы не нужен по заданию — только активное состояние.
    switcher.querySelectorAll('.currency-option').forEach((b) => b.classList.remove('is-active'));
    btn.classList.add('is-active');
  });
}

// Максимально простая карусель: без клонирования слайдов для бесшовной
// петли (не нужно по заданию — "переключение автоматически и/или
// стрелками, точки-индикаторы активны", про бесшовность речи нет).
function initBannerCarousel() {
  const track = document.getElementById('bannerTrack');
  const dotsContainer = document.getElementById('bannerDots');
  const slides = Array.from(track.children);
  let index = 0;

  slides.forEach((_, i) => {
    const dot = document.createElement('button');
    dot.className = 'banner-dot' + (i === 0 ? ' is-active' : '');
    dot.setAttribute('aria-label', `Слайд ${i + 1}`);
    dot.addEventListener('click', () => goTo(i, true));
    dotsContainer.appendChild(dot);
  });
  const dots = Array.from(dotsContainer.children);

  function render() {
    track.style.transform = `translateX(-${index * 100}%)`;
    dots.forEach((d, i) => d.classList.toggle('is-active', i === index));
  }

  let timer;
  function resetTimer() {
    clearInterval(timer);
    timer = setInterval(() => goTo(index + 1), 4000);
  }

  function goTo(i, manual) {
    index = (i + slides.length) % slides.length;
    render();
    if (manual) resetTimer(); // ручной клик не должен сразу перебиваться автопрокруткой
  }

  document.getElementById('bannerPrev').addEventListener('click', () => goTo(index - 1, true));
  document.getElementById('bannerNext').addEventListener('click', () => goTo(index + 1, true));

  render();
  resetTimer();
}

// --- Флоу покупки: "Купить" -> заказ -> "Оплатить" (успех/неуспех, эмуляция
// вебхука) -> поллинг статуса до финального состояния (delivered/
// out_of_stock/delivery_failed/payment_failed). Модалка переиспользуется —
// каждый шаг просто перерисовывает её содержимое.

const STATUS_LABEL = {
  created: 'Заказ создан, ожидает оплаты',
  paid: 'Оплата получена, идёт выдача ключа…',
  delivering: 'Идёт выдача ключа…',
  delivered: 'Готово! Ключ выдан',
  out_of_stock: 'Ключа нет в наличии',
  delivery_failed: 'Не удалось выдать ключ',
  payment_failed: 'Оплата не прошла',
  reservation_expired: 'Бронь истекла',
};

const FINAL_STATUSES = new Set([
  'delivered',
  'out_of_stock',
  'delivery_failed',
  'payment_failed',
  'reservation_expired',
]);

let pollTimer = null;

// Без crypto.randomUUID(): на VDS без TLS страница отдаётся по http, а
// randomUUID() требует secure context (https/localhost) — сломалось бы
// именно на демо-сервере. Уникальности "смотри событие на глаз" достаточно,
// криптостойкость тут не нужна (это же не сам механизм идемпотентности,
// а просто генератор event_id для кнопки-эмулятора).
function randomId(prefix) {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

function stopPolling() {
  clearTimeout(pollTimer);
  pollTimer = null;
}

// Этап 2, задача 3 (бронь с таймером). Отдельный от pollTimer — считает
// локально, тикает раз в секунду чисто на клиенте, не дёргает сервер.
// Источник правды по ИСТЕЧЕНИИ — всё равно сервер (см. startReservationCountdown
// ниже): по достижении 0 клиент переспрашивает реальный статус, а не
// просто рисует "истекло" сам по себе — часы браузера и сервера могут
// немного разойтись.
let reservationTimer = null;

function stopReservationCountdown() {
  clearInterval(reservationTimer);
  reservationTimer = null;
}

function openOrderModal() {
  document.getElementById('orderModalOverlay').hidden = false;
}

function closeOrderModal() {
  stopPolling();
  stopReservationCountdown();
  document.getElementById('orderModalOverlay').hidden = true;
}

function renderModal(html) {
  document.getElementById('orderModalContent').innerHTML = html;
}

function renderLoading(text) {
  renderModal(`<p class="order-status-label">${text}</p>`);
}

// Этап 2, задача 3: тикающий обратный отсчёт до order.reserved_until.
// По достижении 0 — не рисуем "истекло" сами по себе (часы браузера и
// сервера могут разойтись), а переспрашиваем реальный статус заказа и
// заново вызываем renderOrder с тем, что реально вернул сервер (обычно
// это и есть reservation_expired, но если человек успел нажать
// "Оплатить" буквально в последнюю секунду — увидит актуальный статус,
// а не ложное "бронь истекла" поверх уже идущей оплаты).
function startReservationCountdown(order) {
  stopReservationCountdown();
  const el = document.getElementById('reservationCountdown');
  if (!el) return;

  function tick() {
    const msLeft = new Date(order.reserved_until).getTime() - Date.now();
    if (msLeft <= 0) {
      stopReservationCountdown();
      el.textContent = 'Бронь истекает…';
      fetch(`orders/${order.id}`)
        .then((res) => res.json())
        .then(renderOrder)
        .catch(() => {});
      return;
    }
    const totalSeconds = Math.ceil(msLeft / 1000);
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    el.textContent = `Бронь истекает через ${m}:${String(s).padStart(2, '0')}`;
  }
  tick();
  reservationTimer = setInterval(tick, 1000);
}

function renderOrder(order) {
  stopReservationCountdown(); // любая перерисовка сначала гасит старый счётчик — новый (если нужен) заведётся ниже заново
  const label = STATUS_LABEL[order.status] || order.status;
  const idLine = `<p class="order-status-id">Заказ ${order.id}</p>`;

  if (order.status === 'reservation_expired') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <p class="order-error">Бронь истекла — оформите заказ заново.</p>
    `);
    return;
  }

  if (order.status === 'created') {
    // Промокод (Этап 4) — поле прямо в модалке покупки, до оплаты.
    // Один промокод на заказ, без замены (см. promoService.js). Пока
    // не применён — инпут + кнопка; применён — короткая строка с
    // суммой скидки, без "Итого": заказ нигде не хранит и не
    // показывает цену товара, добавлять её сюда ради одной строки
    // избыточно (решение Романа).
    const promoBlock = order.promo_code
      ? `<div class="order-promo-applied">Промокод <strong>${order.promo_code}</strong> применён: −${order.discount_amount} ₽</div>`
      : `
        <div class="order-promo">
          <input type="text" id="promoInput" placeholder="Промокод">
          <button class="btn-secondary" id="promoApplyBtn">Применить</button>
        </div>
        <p class="order-error" id="promoError" hidden></p>
      `;
    // Строка обратного отсчёта — только у заказов с реальным резервом
    // (type='key'); для остальных reserved_until === null, ничего не
    // рисуем.
    const reservationBlock = order.reserved_until ? `<p class="order-reservation" id="reservationCountdown"></p>` : '';

    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      ${reservationBlock}
      ${promoBlock}
      <div class="order-actions">
        <button class="btn-primary" id="paySuccessBtn">Оплатить (успех)</button>
        <button class="btn-secondary" id="payFailBtn">Оплатить (неуспех)</button>
      </div>
    `);
    document.getElementById('paySuccessBtn').addEventListener('click', () => payOrder(order.id, 'paid'));
    document.getElementById('payFailBtn').addEventListener('click', () => payOrder(order.id, 'failed'));
    if (order.reserved_until) startReservationCountdown(order);

    if (!order.promo_code) {
      const promoInput = document.getElementById('promoInput');
      document.getElementById('promoApplyBtn').addEventListener('click', () => applyPromo(order.id));
      promoInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') applyPromo(order.id);
      });
    }
    return;
  }

  if (order.status === 'delivered') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <div class="order-key">${order.issued_code}</div>
    `);
    return;
  }

  // payment_failed: оплата не прошла, заказ ничего не должен покупателю —
  // повторная попытка (новый заказ) действительно решает проблему.
  if (order.status === 'payment_failed') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <p class="order-error">Попробуйте оформить заказ заново.</p>
    `);
    return;
  }

  // out_of_stock/delivery_failed наступают ТОЛЬКО после paid (см. state
  // machine) — оплата уже прошла. Совет "оформите заново" здесь означал бы
  // предложить заплатить второй раз за тот же товар, пока первый платёж
  // просто зависает без выдачи — честная дыра, которую Этап 3 (админ,
  // /admin.html) чинит для ЭТОГО ЖЕ заказа, не через новый. Текст ниже не
  // обещает автоматики (её и нет — уведомлений покупателю не построено),
  // просто не вводит в заблуждение.
  if (order.status === 'out_of_stock' || order.status === 'delivery_failed') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <p class="order-error">Оплата прошла, деньги не потеряны — выдача ключа по этому заказу обрабатывается вручную, повторно оформлять и оплачивать не нужно.</p>
    `);
    return;
  }

  // paid / delivering — промежуточные, ждём финализации поллингом.
  renderModal(`<p class="order-status-label">${label}</p>${idLine}`);
}

async function pollOrder(orderId, attemptsLeft) {
  let order;
  try {
    const res = await fetch(`orders/${orderId}`);
    order = await res.json();
  } catch (err) {
    console.error(err);
    return;
  }

  renderOrder(order);
  if (FINAL_STATUSES.has(order.status)) return;

  if (attemptsLeft <= 0) {
    renderModal(`
      <p class="order-status-label">${STATUS_LABEL[order.status] || order.status}</p>
      <p class="order-status-id">Заказ ${order.id}</p>
      <p class="order-waiting">Выдача занимает дольше обычного, статус обновится сам — можно закрыть окно и вернуться позже.</p>
    `);
    return;
  }
  pollTimer = setTimeout(() => pollOrder(orderId, attemptsLeft - 1), 400);
}

// Применить промокод, не закрывая модалку целиком — в отличие от
// payOrder, сетевая/валидационная ошибка здесь не фатальна для формы,
// просто показываем текст в .order-error и даём попробовать другой код.
async function applyPromo(orderId) {
  const input = document.getElementById('promoInput');
  const errorEl = document.getElementById('promoError');
  const btn = document.getElementById('promoApplyBtn');
  const code = input.value.trim();
  if (!code) return;

  errorEl.hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch(`orders/${orderId}/promo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code }),
    });
    const result = await res.json();
    if (!res.ok) {
      errorEl.textContent = result.error || 'Не удалось применить промокод';
      errorEl.hidden = false;
      btn.disabled = false;
      return;
    }
    // Перечитываем заказ — promo_code/discount_amount теперь на нём,
    // renderOrder сам покажет применённое состояние.
    const order = await (await fetch(`orders/${orderId}`)).json();
    renderOrder(order);
  } catch (err) {
    console.error(err);
    errorEl.textContent = 'Не удалось применить промокод — проверьте, что сервер запущен.';
    errorEl.hidden = false;
    btn.disabled = false;
  }
}

async function payOrder(orderId, status) {
  renderModal(`<p class="order-status-label">Отправляем вебхук оплаты…</p><p class="order-status-id">Заказ ${orderId}</p>`);
  try {
    await fetch('webhook/payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_id: randomId('evt'), order_id: orderId, status }),
    });
  } catch (err) {
    console.error(err);
    renderModal(`<p class="order-error">Не удалось отправить вебхук — проверьте, что сервер запущен.</p>`);
    return;
  }
  pollOrder(orderId, 20); // до ~8с (20 * 400мс) — с запасом на таймаут-ретрай поставщика
}

// Этап 2, бонус 4 (устойчивость к обновлению страницы/повторному
// клику). Обновление страницы стирает всё состояние модалки, но не сам
// заказ на сервере — без этой проверки повторный клик "Купить" на тот
// же товар честно создал бы второй, независимый заказ (а с задачи 2 это
// значит ещё и реально занять второй ключ). Запоминаем в localStorage,
// какой заказ уже "в процессе" по каждому SKU, и при следующей попытке
// сначала спрашиваем сервер о его реальном статусе — самовосстанавливающаяся
// проверка (как sweep в задаче 3): если запись протухла (заказ уже
// финализировался или вовсе не нашёлся), просто продолжаем как обычно,
// ничего не нужно явно чистить заранее.
function pendingOrderKey(sku) {
  return `pendingOrder:${sku}`;
}

async function buyProduct(sku) {
  openOrderModal();
  renderLoading('Проверяем заказ…');

  const existingId = localStorage.getItem(pendingOrderKey(sku));
  if (existingId) {
    try {
      const res = await fetch(`orders/${existingId}`);
      if (res.ok) {
        const existing = await res.json();
        if (!FINAL_STATUSES.has(existing.status)) {
          renderOrder(existing);
          // paid/delivering — ждут автоматической доставки; если это
          // прервалось обновлением страницы, поллинг тоже нужно поднять
          // заново, иначе статус так и останется висеть немым, пока
          // выдача реально уже идёт на сервере.
          if (existing.status === 'paid' || existing.status === 'delivering') pollOrder(existing.id, 20);
          return; // тот же заказ ещё жив — показываем его, новый не создаём
        }
      }
    } catch (err) {
      console.error(err);
      // не удалось проверить — не блокируем покупку, просто пробуем создать новый заказ ниже
    }
    localStorage.removeItem(pendingOrderKey(sku)); // заказ финализирован/не найден — запись больше не актуальна
  }

  renderLoading('Создаём заказ…');
  try {
    const res = await fetch('orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
    });
    const order = await res.json();
    if (!res.ok) {
      renderModal(`<p class="order-error">${order.error || 'Не удалось создать заказ'}</p>`);
      return;
    }
    localStorage.setItem(pendingOrderKey(sku), order.id);
    renderOrder(order);
  } catch (err) {
    console.error(err);
    renderModal(`<p class="order-error">Не удалось создать заказ — проверьте, что сервер запущен.</p>`);
  }
}

// --- Попап "История заказов" (клик по иконке профиля) — уточнение
// постановщика, не входит в docs/task-conditions.md. Одна строка = один
// заказ целиком (покупка/заказ/результат), список подтягивается заново
// при каждом открытии, без отдельной кнопки "Обновить" — так проще и
// нигде больше в проекте нет live-обновлений без действия пользователя.

function statusVariant(status) {
  if (status === 'delivered') return 'delivered';
  if (status === 'out_of_stock' || status === 'delivery_failed' || status === 'payment_failed') return 'failed';
  return 'pending';
}

function historyRowHtml(order) {
  const label = STATUS_LABEL[order.status] || order.status;
  const time = new Date(order.created_at).toLocaleString('ru-RU');
  const codeLine = order.status === 'delivered' && order.issued_code
    ? `<span class="history-row-code">${order.issued_code}</span>`
    : '';
  return `
    <div class="history-row">
      <div class="history-row-top">
        <span class="history-row-name">${order.product_name}</span>
        <span class="history-row-status history-row-status--${statusVariant(order.status)}">${label}</span>
      </div>
      <span class="history-row-meta">${order.id} · ${time}</span>
      ${codeLine}
    </div>
  `;
}

function initHistoryPanel() {
  const toggle = document.getElementById('historyToggle');
  const overlay = document.getElementById('historyModalOverlay');
  const list = document.getElementById('historyList');

  async function open() {
    overlay.hidden = false;
    list.innerHTML = '<p class="order-status-label">Загружаем…</p>';
    try {
      const res = await fetch('orders');
      const orders = await res.json();
      list.innerHTML = orders.length
        ? orders.map(historyRowHtml).join('')
        : '<p class="history-empty">Заказов пока нет.</p>';
    } catch (err) {
      console.error(err);
      list.innerHTML = '<p class="order-error">Не удалось загрузить историю — проверьте, что сервер запущен.</p>';
    }
  }
  function close() {
    overlay.hidden = true;
  }

  toggle.addEventListener('click', open);
  document.getElementById('historyModalClose').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });
}

function initInfoBanner() {
  const banner = document.getElementById('cs2InfoBanner');
  const closeBtn = document.getElementById('cs2InfoBannerClose');
  closeBtn.addEventListener('click', () => banner.remove());
}

const BUY_CLICK_FEEDBACK_MS = 200;

function initPurchaseFlow() {
  document.getElementById('productGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.buy-btn');
    if (!btn || btn.disabled) return;
    // Этап 2, бонус 4: отключаем кнопку синхронно, ДО первого await внутри
    // buyProduct — закрывает по-настоящему быстрый повторный клик на уровне
    // самого DOM-события, ещё до того, как успеет открыться модалка.
    //
    // Небольшая намеренная задержка (BUY_CLICK_FEEDBACK_MS) ПЕРЕД
    // открытием модалки — не технически необходима (сам disabled уже
    // защищает), а ради видимой обратной связи: без неё модалка
    // открывается в тот же такт JS и мгновенно перекрывает кнопку, глазами
    // "посеревшее" состояние физически невозможно заметить — реальность
    // защиты была бы видна только в сетевой вкладке, не на экране.
    // 200мс — достаточно, чтобы заметить, недостаточно, чтобы ощущаться
    // как лаг интерфейса.
    btn.disabled = true;
    setTimeout(() => {
      buyProduct(btn.dataset.sku).finally(() => {
        btn.disabled = false;
      });
    }, BUY_CLICK_FEEDBACK_MS);
  });

  document.getElementById('orderModalClose').addEventListener('click', closeOrderModal);
  document.getElementById('orderModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'orderModalOverlay') closeOrderModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('orderModalOverlay').hidden) closeOrderModal();
  });
}

initSearch(); // до refreshCatalog() — заполняет currentSearch из URL, чтобы первая загрузка сразу учла восстановленный поиск
refreshCatalog();
initCatalogMenu();
initCurrencySwitch();
initBannerCarousel();
initPurchaseFlow();
initHistoryPanel();
initInfoBanner();
initLiveUpdates();
