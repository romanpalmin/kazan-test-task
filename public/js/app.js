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

loadProducts();
