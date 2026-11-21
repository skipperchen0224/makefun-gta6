// Palmetto Heat — the gta6-01 entry program (Node 22, standard library only).
// Hands the game in: copies this file's game/ and screenshots/ into the
// output directory and writes dossier.json with the kit's buildDossier.
// Local run: mkdir out, then MAKEFUN_OUTPUT_DIR=out node main.ts.
// The scorer leaves MAKEFUN_OUTPUT_DIR unset and uses /output.
// --check-only validates without writing anything.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const checkOnly = process.argv.includes('--check-only');
const MAX_SHOT_BYTES = 256 * 1024;
// The platform caps a handed-in dossier at 1.5 MiB, tighter than the
// library's own 4 MiB, so the entry refuses anything over it here first.
const DOSSIER_MAX_BYTES = 1.5 * 1024 * 1024;

function fail(message) {
  console.error(`Palmetto Heat entry check failed: ${message}`);
  process.exit(1);
}

// Preflight, in the same shape as the sealed scorer: the game page must
// exist, the screenshots must be 3 or 4 files, each at most 256 KiB.
const gameIndex = join(here, 'game', 'index.html');
if (!existsSync(gameIndex)) fail('game/index.html: no such file');
const shotsDir = join(here, 'screenshots');
if (!existsSync(shotsDir)) fail('screenshots/: no such directory');
const shotNames = readdirSync(shotsDir).filter((n) => !n.startsWith('.')).sort();
if (shotNames.length < 3 || shotNames.length > 4) {
  fail(`screenshots: expected 3 to 4, found ${shotNames.length} (${shotNames.join(', ')})`);
}
for (const name of shotNames) {
  const bytes = statSync(join(shotsDir, name)).size;
  if (bytes > MAX_SHOT_BYTES) fail(`screenshots/${name}: ${bytes} bytes, over the ${MAX_SHOT_BYTES} allowed`);
}
console.log(`preflight ok: ${shotNames.length} screenshots (${shotNames.join(', ')}), game/index.html present`);
if (checkOnly) {
  console.log('check-only: validated, nothing written');
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
if (dossier.length > DOSSIER_MAX_BYTES) fail(`dossier.json: ${dossier.length} bytes, over the ${DOSSIER_MAX_BYTES} allowed`);
writeFileSync(join(outDir, 'dossier.json'), dossier);
console.log(`dossier ${dossier.length} bytes, ${shotNames.length} screenshots, written to ${outDir}`);
