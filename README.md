# Cabin Pressure

Deterministic prototype simulation for **Cabin Pressure**: a UI-agnostic
airplane cabin logistics game about bladder pressure, lavatory capacity, and
escalating readable chaos.

## Current milestone

Milestone 1 is implemented:

- deterministic seeded passenger generation
- bladder fill by passenger archetype
- request, panic, strike, win, and loss states
- CLI simulation output for an unattended flight

## Commands

```sh
npm run build
npm test
npm run simulate
```

CLI options:

```sh
npm run simulate -- --seed 42 --duration 180 --summary-interval 15
```

## Design docs

The original prototype brief has been split into focused documents:

- [Design index](docs/design/README.md)
- [Core pillars](docs/design/01-core-pillars.md)
- [Prototype architecture](docs/design/02-prototype-architecture.md)
- [Simulation model](docs/design/03-simulation-model.md)
- [Systems and rules](docs/design/04-systems-and-rules.md)
- [Milestone roadmap](docs/design/05-milestone-roadmap.md)
- [Level configuration](docs/design/06-level-configuration.md)