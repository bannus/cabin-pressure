# Level configuration

Levels should be pure data so experiments can be tuned without changing engine
logic.

## Milestone 1 fields

- `id`
- `name`
- `durationSeconds`
- `seed`
- `aircraft.rows`
- `aircraft.seatLayout`
- `aircraft.lavatories`
- `passengerMix`
- `bladder.initialFillRange`
- `bladder.baseFillPerSecond`
- `bladder.requestThreshold`
- `bladder.desperateThreshold`
- `loss.panicGraceSeconds`
- `loss.maxStrikes`
- `loss.strikeRecoveryFillPercent`

## First implemented level

`tiny-readable-cabin`:

- 8 rows
- 4 seats per row
- 2 lavatories in config for future milestones
- 32 passengers
- 180 seconds
- normal, small bladder, and big bladder archetypes
- no movement, cart, turbulence, or baby events yet

## Future fields

Later milestones should add lavatory duration ranges, row exit timings, movement
speed, beverage service, turbulence events, and bot tuning parameters.
