// Админка Этапа 3 — отдельная страница, отдельный скрипт, ничего общего
// с app.js (витрина). Токен хранится в localStorage только этой вкладки,
// не переиспользуется нигде на сайте.

const TOKEN_KEY = 'kazanAdminToken';
const tokenInput = document.getElementById('tokenInput');
const authError = document.getElementById('authError');

tokenInput.value = localStorage.getItem(TOKEN_KEY) || '';

document.getElementById('tokenSave').addEventListener('click', () => {
  localStorage.setItem(TOKEN_KEY, tokenInput.value.trim());
  refreshAll();
});

function authHeaders() {
  return { 'X-Admin-Token': localStorage.getItem(TOKEN_KEY) || '' };
}

// Общая обёртка: 401 показывает подсказку про токен вместо тихого
// провала, остальные ошибки — как есть.
async function adminFetch(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...(options.headers || {}), ...authHeaders() },
  });
  if (res.status === 401) {
    authError.hidden = false;
    authError.textContent = 'Неверный или отсутствующий токен — введите его выше и нажмите "Сохранить".';
    throw new Error('unauthorized');
  }
  authError.hidden = true;
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Ошибка ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const STATUS_LABEL = {
  out_of_stock: 'нет в наличии',
  delivery_failed: 'сбой выдачи',
  delivered: 'выдан',
  delivering: 'выдаётся',
};

async function loadStock() {
  const rows = await adminFetch('admin/stock');
  const tbody = document.querySelector('#stockTable tbody');
  tbody.innerHTML = '';
  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td><code>${row.sku}</code></td><td>${row.available}</td>`;
    tbody.appendChild(tr);
  }
}

async function loadStuck() {
  const rows = await adminFetch('admin/orders/stuck');
  const tbody = document.querySelector('#stuckTable tbody');
  const empty = document.getElementById('stuckEmpty');
  tbody.innerHTML = '';
  empty.hidden = rows.length > 0;

  for (const row of rows) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><code>${row.id}</code></td>
      <td>${row.product_name}</td>
      <td><code class="sku-fill" data-sku="${row.sku}" title="Подставить в форму пополнения ниже">${row.sku}</code></td>
      <td><span class="status status-${row.status}">${STATUS_LABEL[row.status] || row.status}</span></td>
      <td>${new Date(row.updated_at).toLocaleString('ru-RU')}</td>
      <td><button data-id="${row.id}" class="retry-btn">Повторить</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll('.retry-btn').forEach((btn) => {
    btn.addEventListener('click', () => retryOrder(btn.dataset.id, btn));
  });

  // Клик по SKU — не отдельная фича, просто экономит проверяющему
  // копипаст в форму пополнения прямо под этой таблицей.
  tbody.querySelectorAll('.sku-fill').forEach((el) => {
    el.addEventListener('click', () => {
      document.getElementById('restockSku').value = el.dataset.sku;
      document.getElementById('restockSku').focus();
    });
  });
}

async function retryOrder(id, btn) {
  btn.disabled = true;
  btn.textContent = '…';
  try {
    const order = await adminFetch(`admin/orders/${id}/retry`, { method: 'POST' });
    // Если пул всё ещё пуст — заказ вернётся в тот же restorable-статус,
    // строка просто останется в списке после перезагрузки. Если ключ
    // нашёлся — заказ пропадёт из "застрявших".
    void order;
  } catch (err) {
    alert(err.message);
  }
  await refreshAll();
}

document.getElementById('restockBtn').addEventListener('click', async () => {
  const sku = document.getElementById('restockSku').value.trim();
  const count = Number(document.getElementById('restockCount').value);
  const resultEl = document.getElementById('restockResult');
  if (!sku || !Number.isInteger(count) || count < 1) {
    resultEl.textContent = 'Укажите sku и количество';
    return;
  }
  try {
    const result = await adminFetch('admin/keys/restock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sku, count }),
    });
    resultEl.textContent = `Добавлено ${result.added} ключей для ${sku}`;
    await loadStock();
  } catch (err) {
    resultEl.textContent = err.message;
  }
});

document.getElementById('refreshBtn').addEventListener('click', refreshAll);

async function refreshAll() {
  try {
    await Promise.all([loadStock(), loadStuck()]);
  } catch (err) {
    // adminFetch уже показал authError при 401 — остальные ошибки не глушим
    if (err.message !== 'unauthorized') console.error(err);
  }
}

refreshAll();
