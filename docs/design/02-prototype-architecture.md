# Prototype architecture

## Current shared implementation

`src/simulation.ts` is the only rules engine. `src/playtest.ts` imports it
directly; esbuild produces the ignored `public/playtest.js` during
`npm run build`. GitHub Pages builds before publishing. The former standalone
`public/debugger.js` simulation has been removed so browser and tuning runs
cannot silently diverge on strikes, movement, or objectives.

`src/dispatch.ts` supplies player-visible estimates and route suggestions.
`src/tuning.ts` runs constrained policies against the same rules; `npm run tune`
reports survival, clean wins, actions, service, and time-window utilization.

The sections below describe the original milestone sequencing.

## Layers

```text
Core Simulation Engine
  Pure deterministic logic with no UI or mobile dependencies.

Playtest Harness
  CLI first, then a minimal browser debugger immediately after the basic lav
  economy exists.

Mobile Game Shell
  Future renderer and input layer that drives the same simulation.
```

## Recommended stack

Use a TypeScript core with a browser playtest UI first. This keeps determinism,
tests, automated runs, and data-driven experimentation straightforward. If the
game proves fun, either wrap the web version for mobile or port the small core to
Godot.

## Browser debugger timing

Add the browser debugger after Milestone 2, before full physical aisle movement.
The CLI is enough to validate deterministic economy, but the core fun depends on
whether cabin congestion is readable and funny. Waiting until every physical
system exists risks building too much invisible simulation before testing the
visual-spatial play experience.

The first debugger should stay intentionally small:

- schematic cabin grid
- passenger bladder colors
- click passenger and assign front/rear lavatory
- lavatory queue display
- pause, play, and speed controls
- seed/config display
- event log

After this exists, physical aisle movement, blockers, carts, and turbulence can
be evaluated visually as they are added.

## Determinism rules

- Use seeded RNG only.
- Do not read system time inside the simulation.
- Process passengers and commands in stable order.
- Prefer a fixed timestep for automated runs.
- Keep level definitions as data.
