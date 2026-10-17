# Ion Run

A free, endless driving game for the browser. Thread an original electric hypercar through traffic, hop and
flip with thrusters, and drive upside down on the ceiling road. Fictional vehicle, not affiliated with any
manufacturer.

## Run it

You need Node.js 18 or newer.

```bash
npm install
npm run dev        # play at http://localhost:5173
```

Other commands:

```bash
npm run build      # production build into dist/
npm run preview    # serve the build at http://127.0.0.1:4173
npm test           # unit tests (simulation, progression, fuzz)
npx playwright install chromium   # once, for the browser tests
npm run test:e2e   # end-to-end tests (desktop and phone viewports)
```

To publish, upload the contents of `dist/` to itch.io (zip it, with `index.html` at the root), GitHub Pages
or Netlify. All paths are relative and no external assets are loaded.

## Controls

| Action | Keyboard | Touch |
|---|---|---|
| Change lane | Left / Right, A / D | Swipe or tap the left or right half |
| Brake | Down, S | Brake button |
| Thruster hop | Space | Hop button |
| Roll (in the air) | Left / Right | Swipe sideways |
| Flip (in the air) | Up / Down | Swipe up or down |
| Stick to the roof (in a tunnel) | Shift or E | Hold the Hop button |
| Pause | P or Esc | Pause button |

Keys can be remapped in Settings. Gamepad and optional tilt steering are supported.

## How it plays

- The left lane is oncoming traffic and pays double. Pass cars closely to build a streak multiplier.
- The battery drains constantly. Drive over green pads to recharge it. Empty means the run ends.
- Each hop costs one thruster pip. Pips refill from near misses and clean trick landings.
- Roll and flip in the air, then land level for points. Two tricks in one jump make a combo.
- In a tunnel, hop and hold to stick to the roof and drive upside down for double score. Suction runs out.
- Earn coins to unlock liveries in the Garage. Three rotating goals and a daily run give bonuses.

## Project layout

```
src/game/      deterministic simulation (no DOM): spawning, scoring, tricks, ceiling run
src/render/    Three.js scene, procedural car and traffic models, camera, effects
src/audio/     synthesized sound (Web Audio), no audio files
src/input/     keyboard, touch, gamepad, tilt
src/meta/      save data, goals, daily run, leaderboard, unlocks
src/ui/        DOM HUD and menus
tests/         unit, fuzz and end-to-end tests
```

## Accessibility

Remappable keys, reduce-motion option (no shake, camera roll, speed lines or flashes), auto-trick, game speed
and difficulty settings, separate volume sliders, colour-blind-safe traffic colours with distinct shapes,
no flashing above 3 per second, large touch targets and pause on tab switch.
