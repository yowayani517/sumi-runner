// Meshy API で墨ランナー用の3Dアセットを生成するスクリプト
// 使い方: npm run assets            (全アセット生成、既存はスキップ)
//         npm run assets -- coin    (指定アセットのみ再生成)
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'public', 'models');
const BASE = process.env.MESHY_API_BASE_URL || 'https://api.meshy.ai';
const KEY = process.env.MESHY_API_KEY;
if (!KEY) { console.error('MESHY_API_KEY が .env にありません'); process.exit(1); }

const STYLE = 'Japanese sumi-e ink wash painting style, black ink on white washi paper, monochrome, Edo period Japan, hand-painted brush strokes, beautiful, high quality game asset';

const ASSETS = {
  runner: `A young samurai boy running at full sprint, dynamic running pose, flowing clothes and headband, ${STYLE}`,
  dragon: `A majestic Japanese dragon with a long serpentine body, flowing whiskers and mane, coiling through clouds, ${STYLE}`,
  coin: `An Edo period Japanese zeni coin, round bronze coin with a square hole in the center, kanji engravings, weathered metal, monochrome ink style, high quality game asset`,
  scroll: `A rolled Japanese kakemono scroll with wooden ends and a red seal stamp, ${STYLE}`,
  crate: `A large wooden Edo period cargo crate with rope bindings and kanji markings, ${STYLE}`,
  ball: `A giant cracked stone sphere boulder wrapped with rope, rolling obstacle, ${STYLE}`,
  torii: `A low Japanese torii gate with a horizontal beam, weathered wood, ${STYLE}`,
  barrier: `A low bamboo fence barrier, takeyarai, crossed bamboo poles lashed with rope, ${STYLE}`,
  wall: `A tall Japanese wooden wall panel with a climbable lattice, Edo period gate wall, ${STYLE}`,
  lantern: `A Japanese stone lantern, toro, moss covered, ${STYLE}`,
  bamboo: `A cluster of tall bamboo stalks with leaves, ${STYLE}`,
  pagoda: `A Japanese pagoda tower, simple silhouette, black ink style, game asset`,
};

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function poll(id) {
  for (;;) {
    const t = await api('GET', `/openapi/v2/text-to-3d/${id}`);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`task ${id} ${t.status}: ${t.task_error?.message || ''}`);
    process.stdout.write(`\r  ${id} ${t.status} ${t.progress ?? 0}%   `);
    await new Promise(r => setTimeout(r, 10000));
  }
}

async function generate(name, prompt) {
  const out = path.join(OUT_DIR, `${name}.glb`);
  if (fs.existsSync(out)) { console.log(`skip ${name} (exists)`); return; }
  console.log(`\n=== ${name}: preview 生成開始 ===`);
  const prev = await api('POST', '/openapi/v2/text-to-3d', {
    mode: 'preview', prompt, art_style: 'realistic', topology: 'triangle', target_polycount: 15000,
  });
  const prevTask = await poll(prev.result);
  console.log(`\n=== ${name}: refine (テクスチャ) 開始 ===`);
  const ref = await api('POST', '/openapi/v2/text-to-3d', { mode: 'refine', preview_task_id: prevTask.id, enable_pbr: false });
  const refTask = await poll(ref.result);
  const url = refTask.model_urls?.glb;
  if (!url) throw new Error(`${name}: glb url なし`);
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, buf);
  console.log(`\n✓ ${name}.glb 保存 (${(buf.length / 1e6).toFixed(1)}MB)`);
}

const only = process.argv.slice(2);
const targets = only.length ? only : Object.keys(ASSETS);
for (const name of targets) {
  if (!ASSETS[name]) { console.error(`不明なアセット: ${name}`); continue; }
  try { await generate(name, ASSETS[name]); }
  catch (e) { console.error(`\n✗ ${name} 失敗:`, e.message); }
}
console.log('\n完了');
