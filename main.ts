// gta6-01 参赛入口程序（Node 22、只用标准库）；把游戏交上去：把本文件旁边的游戏目录与截图目录复制到输出目录，用 kit 自带的 buildDossier 库写输出目录下的 dossier.json；本地跑法是先建输出目录、再设环境变量跑本文件；评分器里环境变量未设时用 output 目录；加 check-only 参数只校验不写东西。
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const checkOnly = process.argv.includes('--check-only');

function fail(msg) {
  console.error(`Palmetto Heat entry check failed: ${msg}`);
  process.exit(1);
}

// Prechecks, mirroring the sealed scorer: the game entry must exist, the
// screenshots must exist, 3-4 of them, each no bigger than 256 KiB.
const gameIndex = join(here, 'game', 'index.html');
if (!existsSync(gameIndex)) fail(`game entry missing: ${gameIndex}`);
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail(`screenshots directory missing: ${shotsDir}`);
const shots = readdirSync(shotsDir)
  .filter((f) => !f.startsWith('.'))
  .sort();
if (shots.length < 3 || shots.length > 4) {
  fail(`expected 3-4 screenshots, found ${shots.length}: ${shots.join(', ')}`);
}
for (const shot of shots) {
  const size = statSync(join(shotsDir, shot)).size;
  if (size > 262144) fail(`screenshot ${shot} is ${size} bytes, over the 256 KiB limit`);
}
console.log(`precheck ok: ${shots.length} screenshots (${shots.join(', ')}), game entry exists`);
if (checkOnly) {
  console.log('check-only: verified, nothing written');
  process.exit(0);
}

// Stage a clean output directory: fresh game + screenshots, no leftovers.
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'game'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
rmSync(join(outDir, 'dossier.json'), { force: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

// Caps are the competition's: 160 KiB of text, at most 4 screenshots at
// 256 KiB each, at most 993 game files totalling 48 MiB.
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
if (dossier.length > 1572864) fail(`dossier is ${dossier.length} bytes, over the 1.5 MiB limit`);
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`dossier: ${dossier.length} bytes, ${shots.length} screenshots, written to ${join(outDir, 'dossier.json')}`);
