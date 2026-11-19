# Palmetto Heat

[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

An open-world crime game in the spirit of GTA 6, built with three.js.
Palmetto City, Mama Rosa, and everything in between are original —
no Rockstar assets, no borrowed names.

**Play it:** https://skipperchen0224.github.io/makefun-gta6/game/index.html

You can also run it yourself: serve the `game/` folder locally
(`node serve.ts`, then open http://localhost:8080).

## What you're getting into

Palmetto City is a sun-baked grid of avenues, palm trees, and rooftop
AC units, with a beach running down its east edge. You wake up on foot
at the spawn plaza, an orange car parked nearby and $500 in your pocket.

- **Driving** — grab any car you see. F gets you in, WASD steers,
  Space throws the handbrake. Traffic rolls along the road lines and
  the camera stays glued behind you.
- **Six jobs for Mama Rosa** — a pickup, a timed courier run, tailing
  a courier, shaking off 3-star heat, clearing out a rival crew on
  foot, and a 5-star getaway. Press E to take the next job; every
  job pays cash.
- **Wanted, 0–5 stars** — break the law and the heat climbs; stay
  clean and it cools off. Cops chase and ram, start shooting at
  3 stars and up, and at 5 stars a helicopter circles overhead.
- **Combat** — click to shoot on foot. Pedestrians scatter when the
  shooting starts, and cop cars can be disabled.
- **HUD** — cash, health bar, wanted stars, current objective, speed,
  and a live minimap with traffic, cops, and the objective marker.
- **Save** — cash, finished missions, and your best wanted level are
  stored in localStorage, so progress survives closing the tab.

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
