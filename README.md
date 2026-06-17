# Cabin Pressure

Deterministic prototype simulation for **Cabin Pressure**: a UI-agnostic
airplane cabin logistics game about bladder pressure, lavatory capacity, and
escalating readable chaos.

## Current milestone

Milestones 2, 2.5, 3, 4, 5, 6, 7, 8, and 9 are implemented:

- deterministic seeded passenger generation
- bladder fill by passenger archetype
- request, panic, strike, win, and loss states
- lavatory assignment, abstract walking, queues, use duration, returns, and rerouting
- physical aisle cells, row-by-row movement, passing slowdown, and queue positions
- seat blockers, stand/sit timers, aisle-blocking helpers, and stand cooldowns
- beverage cart row service, aisle occupancy, delayed bladder-rate modifiers, and debugger trigger
- turbulence warnings, possible seat belt sign, forced passenger returns, and movement lockout
- baby-attached adult diaper events, long lavatory changes, and debugger indicators
- expanded browser playtest UI with preset configs, seed input, debug actions, summaries, and watchlists
- automated bot runs with batch simulation, aggregate metrics, and config comparison
- CLI simulation output with optional lavatory assignments
- browser debugger for cabin readability and lavatory queue playtesting

## Commands

```sh
npm run build
npm test
npm run simulate
npm run bot
npm run debugger
```

CLI options:

```sh
npm run simulate -- --seed 42 --duration 180 --summary-interval 15
npm run simulate -- --assign P001:front --assign P002:rear
npm run simulate -- --interactive --duration 240
```

### Automated bot runs

Run a deterministic bot across many seeds and compare configs:

```sh
npm run bot
npm run bot -- --seeds 50 --base-seed 1000 --duration 240
```

The bot assigns the neediest passengers to load-balanced nearest lavatories each
tick, then prints win rates and averages for the baseline cabin and a harder
single-lavatory variant.

### Interactive CLI mode

Run with `--interactive` to play a live round from the terminal:

```sh
npm run simulate -- --interactive
```

Available commands while running:

- `assign PASSENGER_ID LAVATORY_ID`
- `assign PASSENGER_ID:LAVATORY_ID`
- `cart start`
- `turbulence start`
- `pause`
- `resume`
- `status`
- `help`
- `quit`

The browser debugger starts at `http://localhost:4173` by default. Set `PORT`
to use another port.

## Design docs

The original prototype brief has been split into focused documents:

- [Design index](docs/design/README.md)
- [Core pillars](docs/design/01-core-pillars.md)
- [Prototype architecture](docs/design/02-prototype-architecture.md)
- [Simulation model](docs/design/03-simulation-model.md)
- [Systems and rules](docs/design/04-systems-and-rules.md)
- [Milestone roadmap](docs/design/05-milestone-roadmap.md)
- [Level configuration](docs/design/06-level-configuration.md)

## GitHub Pages deployment

A workflow is included at `.github/workflows/deploy-pages.yml` to publish the debugger from `public/` to GitHub Pages.

1. In GitHub, open **Settings → Pages** and set **Source** to **GitHub Actions**.
2. Push changes to `main` or `master` (or run the workflow manually from **Actions**).
3. Open the deployed URL: `https://<your-username>.github.io/cabin-pressure/debugger.html`.

This URL works on mobile, so you can test from your phone directly.
