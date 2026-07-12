// ビルドして単一HTMLをデスクトップにも配置する。
// GitHubへの反映は別途 git push（このスクリプト実行後にコミット&プッシュする）。
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

console.log('== build ==');
execSync('npm run build', { cwd: root, stdio: 'inherit' });

const dist = path.join(root, 'dist', 'index.html');
const desktop = path.join(os.homedir(), 'Desktop', '墨ランナー.html');
fs.copyFileSync(dist, desktop);
const mb = (fs.statSync(dist).size / 1e6).toFixed(1);
console.log(`\n✓ デスクトップに配置: ${desktop} (${mb}MB)`);
console.log('  → GitHubへ反映するには git add -A && git commit && git push');
