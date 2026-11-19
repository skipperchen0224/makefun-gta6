[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/skipperchen0224/makefun-gta6/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)

# Palmetto Heat

A browser open-world crime game in the spirit of GTA 6, rendered with
three.js. You start broke on foot in Palmetto City, a sun-bleached
coastal town of avenues, palm trees and a beach along its east edge —
and Mama Rosa has six jobs that will put cash in your pocket and the
police on your tail. Palmetto City, Mama Rosa and the whole cast are
original creations; nothing here is taken from Rockstar.

**Play now:** https://skipperchen0224.github.io/makefun-gta6/game/index.html

Prefer to run it yourself? Serve the `game/` folder locally
(`node serve.ts`, then open http://localhost:8080). No installer, no
account, no download — it just runs in the tab.

## How it plays

You wake up at the spawn plaza with $500 and an orange car parked
nearby. Everything after that is up to you.

- **Take any car** — walk up to one and press F to get in. WASD
  drives, Space pulls the handbrake, and the camera rides behind you
  while traffic flows along the road lines.
- **Six missions from Mama Rosa** — a pickup, a courier run against
  the clock, tailing another courier, losing a 3-star wanted level,
  clearing a rival crew on foot, and a full 5-star getaway. Press E
  to pick up the next job; each one pays.
- **Wanted level, 0–5 stars** — cause trouble and the heat rises;
  lie low and it fades. Police chase and ram you, open fire from
  3 stars onward, and at 5 stars a helicopter joins the hunt.
- **Fight on foot** — click to shoot. Pedestrians flee when shots
  ring out, and police cars can be knocked out of the chase.
- **HUD** — cash, health, wanted stars, your current objective,
  speed, and a live minimap showing traffic, cops and the objective.
- **Progress that sticks** — cash, completed missions and your
  highest wanted level are saved in localStorage, so closing the tab
  doesn't wipe your run.

## Controls

| Key | Does what |
| --- | --- |
| WASD | Move on foot / drive |
| Space | Handbrake |
| Shift | Sprint on foot |
| F | Get in / out of a car |
| E | Accept the next mission |
| Click | Shoot on foot |
| R | Restart after BUSTED / WASTED |

## Under the hood

- Plain static files inside `game/` — there is no build step, and
  nothing is fetched from the network while you play.
- three.js r160, vendored locally as
  `game/vendor/three.module.min.js` — no CDN, no package manager.
- Every sound is synthesized live with WebAudio; the repo ships no
  audio files.
- The code is organized by system: `city`, `vehicles`, `peds`,
  `cops`, `wanted`, `missions`, `hud`, `input`, `audio`, `save`,
  `config`, `main`.

## License

MIT — see [LICENSE](LICENSE).
