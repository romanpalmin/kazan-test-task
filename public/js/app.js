async function loadProducts() {
  const grid = document.getElementById('productGrid');
  try {
    const res = await fetch('/products');
    const products = await res.json();
    grid.innerHTML = products.map(productCardHtml).join('');
  } catch (err) {
    grid.innerHTML = '<p class="product-grid-loading">Не удалось загрузить каталог.</p>';
    console.error(err);
  }
}

function productCardHtml(product) {
  return `
    <article class="product-card" data-sku="${product.sku}">
      <div class="product-card-thumb">${product.type}</div>
      <div class="product-card-name">${product.name}</div>
      <div class="product-card-price">${product.price} ${currencySymbol(product.currency)}</div>
      <button class="btn-primary buy-btn" data-sku="${product.sku}">Купить</button>
    </article>
  `;
}

function currencySymbol(code) {
  return { RUB: '₽', USD: '$', KZT: '₸' }[code] || code;
}

function initCatalogMenu() {
  const toggle = document.getElementById('catalogToggle');
  const menu = document.getElementById('catalogMenu');

  const open = () => {
    menu.hidden = false;
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    menu.hidden = true;
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
};

const FINAL_STATUSES = new Set(['delivered', 'out_of_stock', 'delivery_failed', 'payment_failed']);

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

function openOrderModal() {
  document.getElementById('orderModalOverlay').hidden = false;
}

function closeOrderModal() {
  stopPolling();
  document.getElementById('orderModalOverlay').hidden = true;
}

function renderModal(html) {
  document.getElementById('orderModalContent').innerHTML = html;
}

function renderLoading(text) {
  renderModal(`<p class="order-status-label">${text}</p>`);
}

function renderOrder(order) {
  const label = STATUS_LABEL[order.status] || order.status;
  const idLine = `<p class="order-status-id">Заказ ${order.id}</p>`;

  if (order.status === 'created') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <div class="order-actions">
        <button class="btn-primary" id="paySuccessBtn">Оплатить (успех)</button>
        <button class="btn-secondary" id="payFailBtn">Оплатить (неуспех)</button>
      </div>
    `);
    document.getElementById('paySuccessBtn').addEventListener('click', () => payOrder(order.id, 'paid'));
    document.getElementById('payFailBtn').addEventListener('click', () => payOrder(order.id, 'failed'));
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

  if (order.status === 'out_of_stock' || order.status === 'delivery_failed' || order.status === 'payment_failed') {
    renderModal(`
      <p class="order-status-label">${label}</p>
      ${idLine}
      <p class="order-error">Попробуйте оформить заказ заново.</p>
    `);
    return;
  }

  // paid / delivering — промежуточные, ждём финализации поллингом.
  renderModal(`<p class="order-status-label">${label}</p>${idLine}`);
}

async function pollOrder(orderId, attemptsLeft) {
  let order;
  try {
    const res = await fetch(`/orders/${orderId}`);
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

async function payOrder(orderId, status) {
  renderModal(`<p class="order-status-label">Отправляем вебхук оплаты…</p><p class="order-status-id">Заказ ${orderId}</p>`);
  try {
    await fetch('/webhook/payment', {
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

async function buyProduct(sku) {
  openOrderModal();
  renderLoading('Создаём заказ…');
  try {
    const res = await fetch('/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku }),
    });
    const order = await res.json();
    if (!res.ok) {
      renderModal(`<p class="order-error">${order.error || 'Не удалось создать заказ'}</p>`);
      return;
    }
    renderOrder(order);
  } catch (err) {
    console.error(err);
    renderModal(`<p class="order-error">Не удалось создать заказ — проверьте, что сервер запущен.</p>`);
  }
}

function initPurchaseFlow() {
  document.getElementById('productGrid').addEventListener('click', (e) => {
    const btn = e.target.closest('.buy-btn');
    if (!btn) return;
    buyProduct(btn.dataset.sku);
  });

  document.getElementById('orderModalClose').addEventListener('click', closeOrderModal);
  document.getElementById('orderModalOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'orderModalOverlay') closeOrderModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('orderModalOverlay').hidden) closeOrderModal();
  });
}

loadProducts();
initCatalogMenu();
initCurrencySwitch();
initBannerCarousel();
initPurchaseFlow();
