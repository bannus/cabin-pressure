# Prototype architecture

## Layers

```text
Core Simulation Engine
  Pure deterministic logic with no UI or mobile dependencies.

Playtest Harness
  CLI first, browser debugger later.

Mobile Game Shell
  Future renderer and input layer that drives the same simulation.
```

## Recommended stack

Use a TypeScript core with a browser playtest UI first. This keeps determinism,
tests, automated runs, and data-driven experimentation straightforward. If the
game proves fun, either wrap the web version for mobile or port the small core to
Godot.

## Determinism rules

- Use seeded RNG only.
- Do not read system time inside the simulation.
- Process passengers and commands in stable order.
- Prefer a fixed timestep for automated runs.
- Keep level definitions as data.
