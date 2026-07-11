import { Game } from './game.js';

const $ = id => document.getElementById(id);

const hud = {
  update(score, coins) {
    $('score').textContent = score.toLocaleString();
    $('coin-count').textContent = coins;
  },
  banner(show) { $('dragon-banner').style.opacity = show ? 1 : 0; },
  gameover(score, coins, dist) {
    $('result').innerHTML = `距離 ${dist} 間<br>銭 ${coins} 枚<br>総合 ${score.toLocaleString()} 点`;
    $('gameover-overlay').classList.remove('hidden');
  },
};

const game = new Game($('app'), hud);
window.__game = game;
let paused = false;

await game.loadAssets();

$('start-btn').onclick = () => { $('title-overlay').classList.add('hidden'); game.start(); };
$('retry-btn').onclick = () => { $('gameover-overlay').classList.add('hidden'); game.start(); };
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
