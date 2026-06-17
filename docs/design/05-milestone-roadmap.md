# Milestone roadmap

## Milestone 0: Pure data model

Create and print a cabin with seeded passenger generation and bladder levels.

## Milestone 1: Bladder and win/loss sim

Simulate urgency over time.

Implemented features:

- bladder fill
- archetypes
- request state
- panic state
- strikes
- landing win condition
- CLI output

Success condition:

```text
Can run a 180s flight and see who would fail without intervention.
```

## Milestone 2: Lavatory assignment without physical seats

Add send-to-lav commands, abstract walking time, lav queues, lav duration, return
to seat, and rerouting.

Implemented features:

- `assignPassengerToLavatory` command
- abstract walking time based on passenger row and lavatory row
- lavatory occupancy and FIFO queues
- deterministic lavatory use duration ranges
- return-to-seat state after use
- rerouting before lavatory use

## Milestone 2.5: Minimal browser debugger

Add the browser debugger here rather than waiting for the original UI milestone.
The goal is to test whether the basic bathroom economy is readable and whether
future congestion systems are visually funny.

Initial scope:

- schematic cabin grid
- passenger bladder colors
- passenger selection and lavatory assignment
- lavatory queue display
- pause, play, and speed controls
- seed/config display
- event log

Implemented as `npm run debugger`.

## Milestone 3: Physical aisle movement

Add aisle cells, passenger movement, passing slowdown, and queue positions.

Implemented features:

- `aisleCells` state showing passengers in each aisle row
- row-by-row passenger movement to lavatories and back to seats
- configurable passing slowdown when passengers meet in occupied aisle cells
- physical queue positions for lavatory lines

## Milestone 4: Seat blockers

Add inner-seat dependencies, blockers standing into the aisle, stand/sit timers,
and stand cooldowns.

Implemented features:

- inner seats require seated blockers between them and the aisle to stand first
- blockers and sitting passengers occupy aisle cells while standing/sitting
- configurable stand, sit, and stand-cooldown timers
- blocked assignments wait until required blockers are available

## Milestone 5: Beverage cart

Add a physical cart, row service, delayed bladder-rate modifiers, and debug
triggers.

Implemented features:

- configurable service rows, per-row service duration, and cart movement speed
- cart aisle occupancy while moving or servicing rows
- delayed passenger bladder-rate modifiers after beverage service
- browser debugger trigger and cart visualization

## Milestone 6: Turbulence and seat belt sign

Add warning phase, possible seat belt sign, forced returns, movement lockout, and
debug triggers.

Implemented features:

- configurable warning duration, seat belt sign chance, active duration, and optional auto-start timing
- forced returns for passengers standing, walking, or queued when the sign turns on
- movement lockout while the seat belt sign is active
- browser debugger trigger and status visualization

## Milestone 7: Baby diaper events

Add baby-attached adult events with long lavatory usage and indicators.

Implemented features:

- configurable first/repeat diaper event timings and diaper change duration
- baby-attached adult passengers request lavatory access when a diaper event fires
- diaper changes use the longer lavatory task timing and reschedule follow-up events
- CLI/debugger indicators expose active diaper-change needs

## Milestone 8: Expanded browser playtest UI

Expand the earlier debugger into a fuller playtest harness with debug buttons,
config picker, seed input, richer inspection, and controls for carts,
turbulence, and other later systems.

Implemented features:

- browser config picker with focused playtest presets
- editable seed input for repeatable browser runs
- debug actions for beverage cart, turbulence, baby diaper events, selected bladder state, and neediest-passenger assignment
- selected-passenger inspection with movement, lavatory, blocker, diaper, and beverage details
- playtest summary and passenger watchlist panels

## Milestone 9: Automated bot runs

Add a consistent bot, batch simulation, result output, and config comparison.

Implemented features:

- deterministic bot controller that assigns the neediest passengers to load-balanced nearest lavatories each tick
- `runBotSimulation` produces per-run metrics (status, strikes, assignments, panic events, lavatory visits, queue depth)
- `runBatch` aggregates many seeded runs into win rate and averages
- `compareConfigs` runs the same seed set across labeled configs for balance comparison
- `npm run bot` CLI prints a baseline-vs-variant comparison table

## Milestone 10: Fun evaluation harness

Evaluate whether the game is fun: not too hard, not too easy, not too repetitive,
with interesting decisions (Overcooked-style hectic).

Implemented features:

- `mediumCabin` config (30 rows, 3x3, 180 passengers) as a realistic evaluation level
- pluggable bot strategies (`greedyStrategy`, `panicStrategy`, `fixedLavatoryStrategy`) to measure decision depth via the win-rate gap between smart and naive play
- fun metrics per run: peak/mean concurrent demand, demand spikiness, lavatory utilization, busy fraction, and cross-seed variance (repetitiveness)
- `sweepConfigs` runs config variants across strategies for difficulty sweeps
- `npm run evaluate` reports decision depth, fun metrics, and a lavatory-supply difficulty sweep with interpretation hints
- simulation hot-path optimization (single-pass aisle-cell rebuild and stable passenger object shape) for ~28x faster large-cabin runs

### Desperation / strike behavior fix

While building the harness, the `panic` strategy surfaced a bug: a passenger who hit
100% bladder while walking to or queued for a lavatory was forced into the `Panic`
state, which abandoned their in-progress trip. A bot re-assigning them reset the
panic timer every tick, so they thrashed forever and never actually struck.

The strike timer is now decoupled from the visible `Panic` state:

- `desperateThreshold` drives a desperation timer (`panicSeconds`) that accumulates
  whenever a passenger is over the threshold, regardless of whether they are seated,
  walking, or queued. It now has a real gameplay purpose beyond validation.
- In-progress trips (walking, queued, returning) are preserved even when the
  passenger grows desperate — they keep their place in line.
- A strike fires only when `panicSeconds >= panicGraceSeconds`, after which the
  passenger has an "accident", their bladder is relieved, and any trip is abandoned.
- Only idle (seated) desperate passengers visibly enter the `Panic` state.

Note: this fix also revealed that `mediumCabin` is currently overtuned — the previous
"perfect bot wins" result was an artifact of the bug (strikes were impossible), so
the level needs rebalancing before it is a useful fun benchmark.
