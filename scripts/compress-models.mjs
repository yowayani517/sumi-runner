// public/models/*.glb を軽量化する(テクスチャ1024px化+WebP+quantize)
// 元ファイルは assets_raw/ に退避。npm run compress で実行
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.join(__dirname, '..', 'public', 'models');
const RAW = path.join(__dirname, '..', 'assets_raw');
fs.mkdirSync(RAW, { recursive: true });

const cli = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'gltf-transform.cmd' : 'gltf-transform');

for (const f of fs.readdirSync(MODELS).filter(f => f.endsWith('.glb'))) {
  const src = path.join(MODELS, f);
  const raw = path.join(RAW, f);
  const before = fs.statSync(src).size;
  if (before < 2e6) { console.log(`skip ${f} (${(before / 1e6).toFixed(1)}MB)`); continue; }
  if (!fs.existsSync(raw)) fs.copyFileSync(src, raw); // 退避
  try {
    execFileSync(cli, [
      'optimize', raw, src,
      '--compress', 'quantize',
      '--texture-compress', 'webp',
      '--texture-size', '512',
      '--simplify-error', '0.001',
    ], { stdio: 'pipe', shell: process.platform === 'win32' });
    const after = fs.statSync(src).size;
    console.log(`✓ ${f}: ${(before / 1e6).toFixed(1)}MB -> ${(after / 1e6).toFixed(1)}MB`);
  } catch (e) {
    console.error(`✗ ${f}:`, e.stderr?.toString().slice(-300) || e.message);
  }
}
