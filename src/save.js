// 永続化(localStorage): ベストスコア・累計銭・購入済みアイテム
const KEY = 'sumi-runner-save-v1';

function load() {
  try { return JSON.parse(localStorage.getItem(KEY)) ?? {}; } catch { return {}; }
}

function store(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* プライベートモード等 */ }
}

export const save = {
  get best() { return load().best ?? 0; },
  get totalCoins() { return load().totalCoins ?? 0; },
  get items() { return load().items ?? {}; },

  // ランの結果を反映。ベスト更新ならtrueを返す
  commitRun(score, runCoins) {
    const d = load();
    d.totalCoins = (d.totalCoins ?? 0) + runCoins;
    const isBest = score > (d.best ?? 0);
    if (isBest) d.best = score;
    store(d);
    return isBest;
  },

  buy(id, price) {
    const d = load();
    if ((d.totalCoins ?? 0) < price || d.items?.[id]) return false;
    d.totalCoins -= price;
    d.items = d.items ?? {};
    d.items[id] = true;
    store(d);
    return true;
  },
};

// ショップ商品定義
export const SHOP_ITEMS = [
  { id: 'omamori', name: 'お守り', icon: '🧿', price: 800, desc: '一度だけ被弾を無効化(毎ラン1回)' },
  { id: 'maneki', name: '招き猫', icon: '🐱', price: 500, desc: '銭の獲得量が2倍になる' },
  { id: 'uroko', name: '竜の鱗', icon: '🐉', price: 1200, desc: '竜に乗れる時間+3秒' },
];
