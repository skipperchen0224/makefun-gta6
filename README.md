# Palmetto Heat

[![make.fun — gta6-01](https://img.shields.io/badge/make.fun-gta6--01-orange?style=flat-square)](https://make.fun/c/gta6-01)
[![Prize pool $1,666](https://img.shields.io/badge/prize-%241%2C666-gold?style=flat-square)](https://make.fun/c/gta6-01)
[![Open-world crime game](https://img.shields.io/badge/Palmetto%20Heat-open%20world-teal?style=flat-square)](https://skipperchen0224.github.io/makefun-gta6/game/index.html)

An open-world crime game in the spirit of GTA 6, built with three.js — an
original city, original characters, original story. No Rockstar assets, no
borrowed names: Palmetto City and Mama Rosa are ours.

**Play it:** https://skipperchen0224.github.io/makefun-gta6/game/index.html
(or serve `game/` locally with `node serve.ts` and open http://localhost:8080)

## The game

Palmetto City is a sun-soaked grid of avenues, palms, and rooftop AC units,
with a beach on its east edge. You start on foot by the spawn plaza with an
orange car waiting and $500 in your pocket.

- **Drive** — steal any car (F to enter, WASD + Space handbrake), traffic
  cruises the road lines, and the camera chases behind you.
- **Six missions for Mama Rosa** — pickup, timed courier run, tailing a
  courier, losing a 3-star heat, clearing a rival crew on foot, and a
  5-star getaway. Press E to start the next job; each pays cash.
- **Wanted 0–5 stars** — crimes raise the heat; staying clean lets it decay.
  Cops chase and ram, shoot at 3+ stars, and a helicopter circles at 5.
- **Combat** — click to shoot on foot; peds scatter, cop cars can be disabled.
- **HUD** — cash, health bar, wanted stars, mission objective, speed, and a
  live minimap with traffic, cops, and the objective marker.
- **Save** — cash, completed missions, and best wanted level persist in
  localStorage.

## Controls

| Key | Action |
| --- | --- |
| WASD | Move / drive |
| Space | Handbrake |
| Shift | Sprint (on foot) |
| F | Enter / exit car |
| E | Start next mission |
| Click | Shoot (on foot) |
| R | Restart after BUSTED / WASTED |

## Tech

- Static files under `game/`, no build step, no network requests at runtime.
- three.js r160, vendored as `game/vendor/three.module.min.js`.
- All sound is synthesized with WebAudio — no audio files.
- Source split by job: `city`, `vehicles`, `peds`, `cops`, `wanted`,
  `missions`, `hud`, `input`, `audio`, `save`, `config`, `main`.

## Enter it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
node ../gta6-01-kit/cli/makefun.mjs check --kit ../gta6-01-kit --repo .
```

## License

MIT — see [LICENSE](LICENSE).
