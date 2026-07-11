import { Game } from './game.js';
import { AudioManager } from './audio.js';
import { save, SHOP_ITEMS } from './save.js';

const $ = id => document.getElementById(id);

// ===== 音声(初期は必ず無音・×表示。ユーザーが触って初めて解禁) =====
const audio = new AudioManager();
function bindAudioBtn(btn, get, set) {
  btn.onclick = () => {
    const next = !get();
    set(next);
    btn.querySelector('.state').textContent = next ? '○' : '×';
    btn.classList.toggle('off', !next);
  };
}

const hud = {
  update(score, coins) {
    $('score').textContent = score.toLocaleString();
    $('coin-count').textContent = coins;
  },
  banner(show) { $('dragon-banner').style.opacity = show ? 1 : 0; },
  gameover(score, coins, dist) {
    // 永続化: 累計銭に加算、ベスト更新判定
    const isBest = save.commitRun(score, coins);
    $('result').innerHTML =
      `距離 ${dist} 間<br>銭 ${coins} 枚 <span style="font-size:16px">(累計 ${save.totalCoins.toLocaleString()})</span><br>` +
      `総合 ${score.toLocaleString()} 点<br><span style="font-size:16px">ベスト ${save.best.toLocaleString()} 点</span>`;
    $('gameover-overlay').classList.remove('hidden');
    if (isBest) {
      // ベスト更新バー+「ぽおん」
      audio.pon();
      const b = $('best-banner');
      b.classList.add('show');
      setTimeout(() => b.classList.remove('show'), 2600);
    }
    renderTitleStats();
  },
};

const game = new Game($('app'), hud, audio);
window.__game = game;
let paused = false;

await game.loadAssets();

// ===== タイトルの記録表示 =====
function renderTitleStats() {
  $('title-stats').innerHTML =
    `ベスト <b>${save.best.toLocaleString()}</b> 点 ・ 銭 <b>${save.totalCoins.toLocaleString()}</b> 枚`;
}
renderTitleStats();

// ===== ショップ =====
function renderShop() {
  $('shop-coins').textContent = `所持銭: ${save.totalCoins.toLocaleString()} 枚`;
  const list = $('shop-list');
  list.innerHTML = '';
  for (const item of SHOP_ITEMS) {
    const owned = !!save.items[item.id];
    const el = document.createElement('div');
    el.className = 'shop-item';
    el.innerHTML = `
      <div class="icon">${item.icon}</div>
      <div class="info"><div class="name">${item.name}</div><div class="desc">${item.desc}</div></div>
      <button ${owned || save.totalCoins < item.price ? 'disabled' : ''}>
        ${owned ? '所持済' : item.price + ' 銭'}</button>`;
    el.querySelector('button').onclick = () => {
      if (save.buy(item.id, item.price)) {
        audio.buy();
        renderShop();
        renderTitleStats();
      }
    };
    list.appendChild(el);
  }
}
$('shop-btn').onclick = () => { renderShop(); $('title-overlay').classList.add('hidden'); $('shop-overlay').classList.remove('hidden'); };
$('shop-close-btn').onclick = () => { $('shop-overlay').classList.add('hidden'); $('title-overlay').classList.remove('hidden'); };

bindAudioBtn($('bgm-btn'), () => audio.bgmOn, v => audio.setBgm(v));
bindAudioBtn($('sfx-btn'), () => audio.sfxOn, v => audio.setSfx(v));

$('start-btn').onclick = () => { $('title-overlay').classList.add('hidden'); game.start(save.items); };
$('retry-btn').onclick = () => { $('gameover-overlay').classList.add('hidden'); game.start(save.items); };
$('pause-btn').onclick = () => { if (game.state === 'run' || game.state === 'dragon') { paused = true; $('pause-overlay').classList.remove('hidden'); } };
$('resume-btn').onclick = () => { paused = false; $('pause-overlay').classList.add('hidden'); };

// ===== スワイプ入力 =====
let sx = 0, sy = 0, st = 0;
addEventListener('touchstart', e => { const t = e.touches[0]; sx = t.clientX; sy = t.clientY; st = performance.now(); }, { passive: true });
addEventListener('touchend', e => {
  const t = e.changedTouches[0];
  const dx = t.clientX - sx, dy = t.clientY - sy;
  if (performance.now() - st > 600) return;
  if (Math.abs(dx) < 24 && Math.abs(dy) < 24) return;
  if (Math.abs(dx) > Math.abs(dy)) game.onSwipe(dx > 0 ? 'right' : 'left');
  else game.onSwipe(dy > 0 ? 'down' : 'up');
}, { passive: true });

addEventListener('keydown', e => {
  const map = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down', a: 'left', d: 'right', w: 'up', s: 'down', ' ': 'up' };
  if (map[e.key]) game.onSwipe(map[e.key]);
});

// ===== メインループ =====
// rAFが止まる環境(非表示ペイン等)ではsetTimeoutにフォールバック
let last = performance.now();
let lastFrame = performance.now();
function loop(now) {
  lastFrame = now;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (!paused) game.update(dt);
  game.render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
setInterval(() => {
  const now = performance.now();
  if (now - lastFrame > 250) loop(now);
}, 100);
