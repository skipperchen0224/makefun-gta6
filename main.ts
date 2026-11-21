// Palmetto Heat — make.fun entrypoint (Node 22, standard library only).
// Copies game/ and screenshots/ into the output directory and writes
// dossier.json there with the kit's buildDossier library.
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// Without MAKEFUN_OUTPUT_DIR the output directory is /output.
//   node main.ts --check-only   only validates, writes nothing.

import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR || '/output';
const checkOnly = process.argv.includes('--check-only');
const gameDir = join(here, 'game');
const shotsDir = join(here, 'screenshots');
const indexHtml = join(gameDir, 'index.html');
const MAX_SHOT_BYTES = 262144;

function fail(message: string): never {
  console.error(`Palmetto Heat entry check failed: ${message}`);
  process.exit(1);
}

// ---- Preflight: the same checks the sealed scorer runs, before copying. ----
if (!existsSync(indexHtml)) fail('game/index.html is missing');
if (!existsSync(shotsDir) || !statSync(shotsDir).isDirectory()) {
  fail('screenshots/ directory is missing');
}
const shots = readdirSync(shotsDir)
  .filter((name) => !name.startsWith('.'))
  .sort();
if (shots.length < 3 || shots.length > 4) {
  fail(`expected 3 to 4 screenshots, found ${shots.length}: ${shots.join(', ') || '(none)'}`);
}
for (const name of shots) {
  if (!/\.(png|jpe?g)$/i.test(name)) {
    fail(`screenshot ${name} is not a PNG or JPEG image`);
  }
  const bytes = statSync(join(shotsDir, name)).size;
  if (bytes > MAX_SHOT_BYTES) {
    fail(`screenshot ${name} is ${bytes} bytes, over the 262144 byte limit`);
  }
}
console.log(`preflight ok: ${shots.length} screenshots (${shots.join(', ')}), game/index.html present`);
if (checkOnly) {
  console.log('check-only: validated, wrote nothing');
  process.exit(0);
}

// ---- Output: fresh game/ + screenshots/, then the dossier. ----
mkdirSync(outDir, { recursive: true });
rmSync(join(outDir, 'game'), { recursive: true, force: true });
rmSync(join(outDir, 'screenshots'), { recursive: true, force: true });
rmSync(join(outDir, 'dossier.json'), { force: true });
cpSync(gameDir, join(outDir, 'game'), { recursive: true });
mkdirSync(join(outDir, 'screenshots'), { recursive: true });
cpSync(shotsDir, join(outDir, 'screenshots'), { recursive: true });

const dossier = buildDossier(outDir, {
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
  game_max_files: 993,
  game_max_bytes: 50331648,
  game_path_max_bytes: 1000,
});
const dossierBytes = Buffer.isBuffer(dossier) ? dossier : Buffer.from(dossier);
if (dossierBytes.length > 1.5 * 1024 * 1024) {
  fail(`dossier is ${dossierBytes.length} bytes, over the 1.5 MiB limit`);
}
writeFileSync(join(outDir, 'dossier.json'), dossierBytes);
console.log(`dossier written: ${dossierBytes.length} bytes, ${shots.length} screenshots, ${join(outDir, 'dossier.json')}`);
