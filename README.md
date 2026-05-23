# Cabin Pressure

Deterministic prototype simulation for **Cabin Pressure**: a UI-agnostic
airplane cabin logistics game about bladder pressure, lavatory capacity, and
escalating readable chaos.

## Current milestone

Milestones 2 and 2.5 are implemented:

- deterministic seeded passenger generation
- bladder fill by passenger archetype
- request, panic, strike, win, and loss states
- lavatory assignment, abstract walking, queues, use duration, returns, and rerouting
- CLI simulation output with optional lavatory assignments
- minimal browser debugger for cabin readability and lavatory queue playtesting

## Commands

```sh
npm run build
npm test
npm run simulate
npm run debugger
```

CLI options:

```sh
npm run simulate -- --seed 42 --duration 180 --summary-interval 15
npm run simulate -- --assign P001:front --assign P002:rear
```

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
