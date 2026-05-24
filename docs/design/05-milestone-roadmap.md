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

## Milestone 7: Baby diaper events

Add baby-attached adult events with long lavatory usage and indicators.

## Milestone 8: Expanded browser playtest UI

Expand the earlier debugger into a fuller playtest harness with debug buttons,
config picker, seed input, richer inspection, and controls for carts,
turbulence, and other later systems.

## Milestone 9: Automated bot runs

Add a consistent bot, batch simulation, result output, and config comparison.
