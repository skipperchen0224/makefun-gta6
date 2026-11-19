# Palmetto Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the spirit of GTA 6, built with three.js.
Everything here is original — the city, the characters, the story.
Palmetto City and Mama Rosa are ours; no Rockstar assets, no borrowed names.

**Play it:** https://skipperchen0224.github.io/makefun-gta6/game/index.html

Or run it yourself: serve the `game/` folder locally
(`node serve.ts`, then open http://localhost:8080).

## The game

Palmetto City is a sun-soaked grid of avenues, palm trees, and rooftop
AC units, with a beach along its east edge. You start on foot by the
spawn plaza — an orange car waiting nearby, $500 in your pocket.

- **Drive** — take any car you find (F to get in, WASD to drive, Space
  for the handbrake). Traffic cruises the road lines and the camera
  chases behind you.
- **Six missions for Mama Rosa** — a pickup, a timed courier run,
  tailing a courier, shaking off a 3-star heat, clearing a rival crew
  on foot, and a 5-star getaway. Press E to take the next job; every
  job pays cash.
- **Wanted, 0–5 stars** — breaking the law raises the heat; staying
  clean lets it cool down. Cops chase and ram, open fire at 3 stars
  and up, and a helicopter circles overhead at 5.
- **Combat** — click to shoot on foot. Pedestrians scatter, and cop
  cars can be disabled.
- **HUD** — cash, health bar, wanted stars, current objective, speed,
  and a live minimap showing traffic, cops, and the objective marker.
- **Save** — your cash, finished missions, and best wanted level are
  kept in localStorage, so progress survives closing the tab.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| Space | Handbrake |
| Shift | Sprint (on foot) |
| F | Enter / exit car |
| E | Start the next mission |
| Click | Shoot (on foot) |
| R | Restart after BUSTED / WASTED |

## Tech

- Static files under `game/` — no build step, no network requests
  while playing.
- three.js r160, vendored in the repo as
  `game/vendor/three.module.min.js` — no CDN, no package manager.
- All sound is synthesized with WebAudio; there are no audio files.
- Code is split by job: `city`, `vehicles`, `peds`, `cops`, `wanted`,
  `missions`, `hud`, `input`, `audio`, `save`, `config`, `main`.

## License

MIT — see [LICENSE](LICENSE).
