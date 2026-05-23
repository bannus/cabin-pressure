# Prototype architecture

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
