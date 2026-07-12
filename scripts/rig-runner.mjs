// runnerモデルを Remesh → リギング → 走りアニメーション付きGLBとして保存
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, '..', 'src', 'models');
const BASE = process.env.MESHY_API_BASE_URL || 'https://api.meshy.ai';
const KEY = process.env.MESHY_API_KEY;
const RUNNER_TASK = '019f50ca-76e6-7a95-968a-114dba817c5e'; // refine済みrunner

const headers = { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

async function api(method, url, body) {
  const res = await fetch(`${BASE}${url}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

async function poll(pathBase, id) {
  for (;;) {
    const t = await api('GET', `${pathBase}/${id}`);
    if (t.status === 'SUCCEEDED') return t;
    if (t.status === 'FAILED' || t.status === 'CANCELED') throw new Error(`${id} ${t.status}: ${JSON.stringify(t.task_error || {})}`);
    process.stdout.write(`\r${pathBase} ${t.status} ${t.progress ?? 0}%   `);
    await new Promise(r => setTimeout(r, 8000));
  }
}

async function download(url, file) {
  const buf = Buffer.from(await (await fetch(url)).arrayBuffer());
  fs.writeFileSync(path.join(OUT_DIR, file), buf);
  console.log(`✓ ${file} (${(buf.length / 1e6).toFixed(1)}MB)`);
}

// 1. Remesh (ポリゴン削減)
console.log('=== Remesh 開始 ===');
const rm = await api('POST', '/openapi/v1/remesh', {
  input_task_id: RUNNER_TASK,
  target_formats: ['glb'],
  topology: 'triangle',
  target_polycount: 20000,
});
const rmTask = await poll('/openapi/v1/remesh', rm.result);
console.log('\nRemesh 完了:', rmTask.id);

// 2. リギング + アニメーション
console.log('=== Rigging 開始 ===');
const rig = await api('POST', '/openapi/v1/rigging', { input_task_id: rmTask.id });
const rigTask = await poll('/openapi/v1/rigging', rig.result);
console.log('\nRigging 結果:', JSON.stringify(rigTask, null, 2));

// 結果からアニメーションGLBを保存(runningがあれば優先)
const r = rigTask.result || rigTask;
const anims = r.basic_animations || {};
const candidates = [
  ['runner_run.glb', anims.running_glb_url || anims.running?.glb_url],
  ['runner_walk.glb', anims.walking_glb_url || anims.walking?.glb_url],
  ['runner_rigged.glb', r.rigged_model_glb_url || r.model_urls?.glb],
];
for (const [file, url] of candidates) {
  if (url) await download(url, file);
}
console.log('完了');
