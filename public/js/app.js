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

loadProducts();
initCatalogMenu();
initCurrencySwitch();
initBannerCarousel();
