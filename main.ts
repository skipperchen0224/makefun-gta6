// Palmetto Heat entry point for gta6-01 (Node 22, standard library only).
// Hands the game in: copies game/ and screenshots/ next to this file into
// the output directory, then writes dossier.json with the kit's
// buildDossier library. Local run: mkdir -p out && MAKEFUN_OUTPUT_DIR=out
// node main.ts. Inside the scorer MAKEFUN_OUTPUT_DIR is unset and the
// output directory is /output. `node main.ts --check-only` validates
// without writing anything. Round 5 re-record: the preflight now expects
// 3–4 screenshots and the combat frame is the third image.
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const checkOnly = process.argv.includes('--check-only');

function fail(message) {
  console.error(`Palmetto Heat entry check failed: ${message}`);
  process.exit(1);
}

const gameIndex = join(here, 'game', 'index.html');
if (!existsSync(gameIndex)) fail('game/index.html is missing');
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('screenshots/ is missing');
const shots = readdirSync(shotsDir)
  .filter((name) => !name.startsWith('.'))
  .sort();
if (shots.length < 3 || shots.length > 4) {
  fail(`expected 3–4 screenshots, found ${shots.length}: ${shots.join(', ')}`);
}
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 256 * 1024) fail(`screenshot ${name} is ${size} bytes, over the 256 KiB limit`);
}
console.log(`Palmetto Heat entry check passed: ${shots.length} screenshots (${shots.join(', ')}), game/index.html present`);
if (checkOnly) {
  console.log('check-only: nothing written');
  process.exit(0);
}

mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'game'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
rmSync(join(outDir, 'dossier.json'), { force: true });
cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
if (dossier.length > 1.5 * 1024 * 1024) {
  fail(`dossier is ${dossier.length} bytes, over the 1.5 MiB limit`);
}
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`wrote dossier.json (${dossier.length} bytes, ${shots.length} screenshots) to ${outDir}`);
// Round 5 entry build: game + screenshots + dossier, deterministic across runs.
