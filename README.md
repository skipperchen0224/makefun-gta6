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

Round 4 adds lit windows and street lamps after dark, and instanced city props that cut draw calls.
Round 5 adds a three-gun arsenal, pickups, a rival crew that shoots back, line-of-sight police with roadblocks, lane-keeping traffic, story calls and sun shadows.

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
- **Arsenal and pickups (Round 5)** — pistol (12-round mag, 34 dmg),
  SMG (30 rounds, full auto, unlocks after job 3) and shotgun (6 shells,
  6 pellets, unlocks after job 4) on 1/2/3, with magazines, reserves and
  a 1.3 s reload on R. Sixteen health / armour / ammo / cash pickups sit
  on street corners and respawn after 45 s; downed crew drop ammo or
  cash, wrecked cruisers drop armour. Soft aim assist (12°) picks the
  closest target in line of sight.
- **Enemies that fight back (Round 5)** — the Street Sweep crew hold
  their ground at 14 m and shoot every 1.1–1.9 s (55 % hit on foot,
  30 % against a fast car). Run someone over and it counts.
- **Smarter police (Round 5)** — cruisers drive the street grid when a
  building is in the way, arrive on roads, and only shoot with line of
  sight. Stars cool off only after 8 s out of sight of every unit (the
  stars flash blue while you're evading). From 3 stars, roadblocks of
  two cruisers appear across the intersection ahead every 22 s; at 4
  stars two units move to intercept; stop next to a cop for 2 s and
  you're BUSTED in the car.
- **Living streets (Round 5)** — 18 cars keep right in lanes 2.6 m off
  the centre line, turn at 35 % of intersections and brake for anything
  ahead; 28 pedestrians stroll the sidewalks. Both are recycled near
  you once they're 190 m away, so the blocks around you stay busy.
- **Story (Round 5)** — Mama Rosa, Jason and Lucia call in after every
  job, from the prologue to the finale.
- **Light and weather polish (Round 5)** — real-time sun shadows
  (2048² map, a 140 m box following you), additive glow on every
  lamp, headlight, tail light and light bar at night, a helicopter
  searchlight beam that tracks you, rain drawn as streaks, and fog
  that takes the sky colour so dusk and storms blend at the horizon.
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
  in localStorage, so closing the tab doesn't wipe your run. Round 5
  also saves your ammo, and the title screen shows the save it found.

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
| R | Reload (restart after BUSTED / WASTED) |
| 1 / 2 / 3 | Pistol / SMG / shotgun |
| P | Pause |
| N | New game (title screen, wipes the save) |

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
  `config`, `main` — plus `weapons` and `pickups` (Round 5), `characters` (the two leads), `weather`
  (clock, rain, lightning), `ecs` (particles), `bgm` (music) and
  `multiplayer` (the lobby client). `serve.ts` serves the game and
  the lobby on one port with a hand-rolled WebSocket implementation
  (Node standard library only).
- `main.ts` hands the entry in and pre-flights it first (3–4
  screenshots, each at most 256 KiB, dossier at most 1.5 MiB);
  `node main.ts --check-only` validates without writing anything.

## License

MIT — see [LICENSE](LICENSE).

Round 4: windows, lamps and headlights glow at night, and the city's static props are instanced, cutting daytime draw calls from 333 to about 127.

Round 5: weapons, pickups, crew that shoot back, line-of-sight police with roadblocks and intercepts, lane traffic, story calls, sun shadows and night glow.
