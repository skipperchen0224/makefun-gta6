// Palmetto Heat — gta6-01 entry program (Node 22, standard library only).
// Hands the game in: copies game/ and screenshots/ from beside this file into
// the output directory and writes /output/dossier.json with the kit's vendored
// buildDossier library. Run it locally as:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader, MAKEFUN_OUTPUT_DIR is unset and /output is used instead.
// Pass --check-only to validate the entry without writing anything.
//
// Before copying, it pre-flights the entry the way the sealed scorer will:
// game/index.html must exist, screenshots must number 3 or 4, and every
// screenshot must be at most 256 KiB — so a bad shot fails here, loudly,
// instead of silently handing in an entry the scorer would refuse.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const checkOnly = process.argv.includes('--check-only');

function fail(message) {
  console.error(`Palmetto Heat entry check failed: ${message}`);
  process.exit(1);
}

// Pre-flight: the entry the scorer would refuse is refused here first.
const indexHtml = join(here, 'game', 'index.html');
if (!existsSync(indexHtml)) fail('game/index.html is missing');
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('screenshots/ is missing');
const shots = readdirSync(shotsDir)
  .filter((name) => !name.startsWith('.'))
  .sort();
if (shots.length < 3 || shots.length > 4) {
  fail(`expected 3 or 4 screenshots, found ${shots.length}: ${shots.join(', ')}`);
}
for (const name of shots) {
  const size = statSync(join(shotsDir, name)).size;
  if (size > 262144) fail(`screenshot ${name} is ${size} bytes, over the 256 KiB cap`);
}
console.log(`Pre-flight ok: ${shots.length} screenshots (${shots.join(', ')}), game/index.html present.`);

if (checkOnly) {
  console.log('Check-only mode: nothing written.');
  process.exit(0);
}

// Start from a clean output directory so stale files can never leak in.
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'game'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
rmSync(join(outDir, 'dossier.json'), { force: true });

cpSync(join(here, 'game'), join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) {
  cpSync(join(here, 'screenshots'), join(outDir, 'screenshots'), { recursive: true });
}

// The scorer's caps from the kit's reference/gate.json: only text_max_bytes
// shapes the dossier bytes; the rest refuse an entry the scorer would refuse
// (more than 4 screenshots, one over 256 KiB, more than 993 game files or
// 48 MiB of game files, or a game path over 1000 bytes).
const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

// The dossier itself has a cap too (1.5 MiB): refuse to call the entry
// done if the library ever writes past it.
if (dossier.length > 1572864) {
  fail(`dossier.json is ${dossier.length} bytes, over the 1.5 MiB cap`);
}

// One line on stdout so a local run shows what landed, without touching bytes.
console.log(`Palmetto Heat dossier written: ${dossier.length} bytes (${shots.length} screenshots) -> ${join(outDir, 'dossier.json')}`);
