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

## Two leads

Palmetto Heat has two protagonists, and you can swap between them
anywhere with **Q**:

- **Lucia, the wheelwoman** — quicker on foot, sharper handling,
  lighter armour. She drives like the city owes her money.
- **Jason, the heavy** — more health, more armour, slower on foot.
  He hits hard and soaks up worse.

Each lead hears Mama Rosa's jobs differently, drives with their own
grip, and is remembered by the save — so the city remembers who you
were last playing as.

## How it plays

You wake up at the spawn plaza with $500 and an orange car parked
nearby. Everything after that is up to you.

- **Take any car** — walk up to one and press F to get in. WASD
  drives, Space pulls the handbrake, and the camera rides behind you
  while traffic flows along the road lines.
- **Drift** — hold Space at speed and the back steps out. Slide
  through a corner to bank drift points into cash — but a big show in
  front of a cop car draws heat, and a wall ends the slide with
  nothing banked. Tyre smoke, skid hiss and a live drift score
  included.
- **Six missions from Mama Rosa** — a pickup, a courier run against
  the clock, tailing another courier, losing a 3-star wanted level,
  clearing a rival crew on foot, and a full 5-star getaway. Press E
  to pick up the next job; each one pays.
- **Wanted level, 0–5 stars** — cause trouble and the heat rises;
  lie low and it fades. Police chase and ram you, open fire from
  3 stars onward, and at 5 stars a helicopter joins the hunt — with a
  searchlight after dark. Drifting past a cop or leaning on the horn
  in their face counts as reckless driving, and a loud enough slide
  sends the nearest unit to investigate.
- **Fight on foot** — click to shoot, with recoil and a muzzle
  tracer. Pedestrians flee when shots ring out, and police cars can
  be knocked out of the chase.
- **Armour** — damage eats your armour bar first, health second.
  Stay quiet for ten seconds and the armour starts growing back.
- **Weather and day/night** — a 24-hour clock runs over eight real
  minutes. Dawn amber, noon white, dusk orange, night blue with the
  street lamps on. Rain rolls in on its own, storms flash lightning,
  and pedestrians hurry when it pours.
- **Night that looks like night (Round 4)** — windows glow warm after
  dark, lamp heads and headlights switch on, the road catches a faint
  blue sheen, and the city's static props (roofs, AC units, palms,
  lamps, dashes) are instanced per tile with frustum culling, cutting
  daytime draw calls from ~333 to ~127.
- **Synthwave BGM** — press M for Palmetto Nights FM: a 100 BPM
  A-minor loop of saw bass, square arp, pads and kick, synthesized
  live with WebAudio. It darkens at night and tightens in a chase.
- **Multiplayer (optional)** — `node serve.ts`, then open
  `http://localhost:8080/?mp=1` in two tabs. The same port runs a
  tiny lobby: no accounts, just ghost drivers, positions and chat.
  Press T to wave.
- **HUD** — cash, health, armour, wanted stars, your current lead,
  the in-game clock and weather, your current objective, speed, a
  drift score, and a live minimap showing traffic, cops and the
  objective.
- **Progress that sticks** — cash, completed missions, your highest
  wanted level, your lead, your armour and your best drift are saved
  in localStorage, so closing the tab doesn't wipe your run.

## Controls

| Key | Does what |
| --- | --- |
| WASD | Move on foot / drive |
| Space | Handbrake / drift |
| Shift | Sprint on foot |
| F | Get in / out of a car |
| E | Accept the next mission |
| Click | Shoot on foot |
| Q | Swap lead (Lucia / Jason) |
| M | Synthwave music on / off |
| H | Horn (in a car) |
| T | Wave (multiplayer lobby) |
| Wheel | Zoom the chase camera |
| R | Restart after BUSTED / WASTED |

## Under the hood

- Plain static files inside `game/` — there is no build step, and
  nothing is fetched from the network while you play.
- three.js r160, vendored locally as
  `game/vendor/three.module.min.js` — no CDN, no package manager.
- Every sound is synthesized live with WebAudio; the repo ships no
  audio files. The BGM is a lookahead-scheduled synthwave sequencer.
- A tiny entity-component-system (`game/src/ecs.js`) runs the
  particle effects — tyre smoke, muzzle sparks, rain splashes — on
  one pooled `THREE.Points`, one draw call, zero allocation per frame.
- The code is organized by system: `city`, `vehicles`, `peds`,
  `cops`, `wanted`, `missions`, `hud`, `input`, `audio`, `save`,
  `config`, `main` — plus `characters` (the two leads), `weather`
  (clock, rain, lightning), `ecs` (particles), `bgm` (music) and
  `multiplayer` (the lobby client). `serve.ts` serves the game and
  the lobby on one port with a hand-rolled WebSocket implementation
  (Node standard library only).
- `main.ts` hands the entry in and pre-flights it first (3–4
  screenshots, each at most 256 KiB, dossier at most 1.5 MiB);
  `node main.ts --check-only` validates without writing anything.

## License

MIT — see [LICENSE](LICENSE).
