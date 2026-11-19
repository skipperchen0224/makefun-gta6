// Palmetto Heat — gta6-01 entry program (Node 22, standard library only).
// Hands the game in: copies game/ and screenshots/ from beside this file into
// the output directory and writes /output/dossier.json with the kit's vendored
// buildDossier library. Run it locally as:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
// In the grader, MAKEFUN_OUTPUT_DIR is unset and /output is used instead.

import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

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

// One line on stdout so a local run shows what landed, without touching bytes.
console.log(`Palmetto Heat dossier written: ${dossier.length} bytes -> ${join(outDir, 'dossier.json')}`);
