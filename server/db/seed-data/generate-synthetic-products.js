// Этап 2, бонус 5 (поиск по каталогу тысяч позиций). Свои 12 товаров из
// условия задания (products.json) — маленький, курируемый набор, три из
// них с реальной выдачей (см. keys.json/seed.js). Эти тысячи — синтетика
// исключительно для демонстрации поиска/фильтров на масштабе, отдельным
// SKU-префиксом (GEN-...), никогда не пересекаются с настоящим каталогом
// и никогда не получают пул ключей (даже у type='key' — по той же логике,
// что и у 9 "нерабочих" товаров исходного каталога, см.
// docs/backend-architecture.md §9).
//
// Без стороннего генератора (faker и подобные) — в проекте нет такой
// зависимости, тащить её ради одноразовой генерации не стали (решение
// Романа 11.09, "не усложняем"). Вместо этого — детерминированный
// генератор (свой mulberry32, не Math.random()): одни и те же 5000 SKU
// при каждом запуске получают одни и те же имя/цену — иначе повторный
// `npm run seed` не был бы по-настоящему идемпотентным (INSERT OR IGNORE
// молчаливо не обновил бы уже вставленные строки, а при первой вставке в
// разных окружениях каталог отличался бы).

function mulberry32(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(arr, rng) {
  return arr[Math.floor(rng() * arr.length)];
}

const GAME_WORDS = [
  'Sword', 'Shadow', 'Galaxy', 'Legends', 'Empire', 'Quest', 'Arena', 'Kingdom',
  'Storm', 'Phoenix', 'Dragon', 'Frontier', 'Odyssey', 'Rebellion', 'Horizon',
  'Nexus', 'Vortex', 'Echo', 'Genesis', 'Eclipse', 'Reactor', 'Colony', 'Drift',
];
const GAME_SUFFIX = [
  'Online', 'Wars', 'Chronicles', 'Rising', 'Tactics', 'Legacy', 'Origins',
  'Remastered', 'II', 'III', 'Reborn', '',
];
const SERVICES = [
  'Netflix', 'Spotify', 'YouTube Music', 'Disney+', 'Apple Music', 'Deezer',
  'Amazon Prime', 'Кинопоиск', 'IVI', 'Okko', 'Яндекс Плюс', 'СберПрайм',
];
const STORES = [
  'PlayStation', 'Xbox', 'Nintendo', 'Steam', 'Epic Games', 'Roblox',
  'App Store', 'Google Play', 'VK Play',
];
const SUB_MONTHS = [1, 3, 6, 12];
const TOPUP_AMOUNTS = [100, 250, 500, 1000, 1500, 2000, 3000, 5000];
const GIFT_AMOUNTS = [500, 1000, 1500, 2000, 3000];

function generateSyntheticProducts(count, seed = 42) {
  const rng = mulberry32(seed);
  const products = [];
  // Пропорция типов — примерно как в реальном каталоге (ключей и
  // пополнений больше, подписок и гифт-карт меньше), не поровну на
  // четыре — так каталог выглядит правдоподобнее.
  const TYPES = ['key', 'key', 'topup', 'topup', 'subscription', 'giftcard'];

  for (let i = 1; i <= count; i++) {
    const type = pick(TYPES, rng);
    const sku = `GEN-${type.toUpperCase()}-${String(i).padStart(5, '0')}`;
    let name;
    let price;

    if (type === 'key') {
      const suffix = pick(GAME_SUFFIX, rng);
      name = `${pick(GAME_WORDS, rng)}${suffix ? ' ' + suffix : ''} ключ активации`;
      price = 300 + Math.floor(rng() * 4700);
    } else if (type === 'topup') {
      const amount = pick(TOPUP_AMOUNTS, rng);
      name = `Пополнение ${pick(STORES, rng)} ${amount} ₽`;
      price = amount;
    } else if (type === 'subscription') {
      const months = pick(SUB_MONTHS, rng);
      name = `${pick(SERVICES, rng)} Premium ${months} мес.`;
      price = 150 * months + Math.floor(rng() * 200);
    } else {
      const amount = pick(GIFT_AMOUNTS, rng);
      name = `${pick(STORES, rng)} Gift Card ${amount} ₽`;
      price = amount;
    }

    products.push({
      sku,
      name,
      type,
      price,
      currency: 'RUB',
      image: 'assets/placeholder.svg',
    });
  }
  return products;
}

module.exports = { generateSyntheticProducts };
