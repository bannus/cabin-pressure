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
- future: `bladder.initialFillDistribution`
- `bladder.baseFillPerSecond`
- `bladder.requestThreshold`
- `bladder.desperateThreshold`
- `lavatory.minimumWalkSeconds`
- `lavatory.walkSecondsPerRow`
- `lavatory.useDurationSeconds`
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

## Initial bladder tuning

For early correctness tests, a simple deterministic range is useful. For
playtests, prefer a weighted distribution so passenger urgency feels less
synchronized and more like real boarding behavior.

Recommended playtest shape:

```json
{
  "initialFillDistribution": [
    { "weight": 0.7, "range": [0.0, 0.45] },
    { "weight": 0.25, "range": [0.45, 0.8] },
    { "weight": 0.05, "range": [0.8, 0.95] }
  ]
}
```

The exact weights should remain a tuning target. Immediate emergencies can be
fun in small doses, but too many high-fill passengers at spawn may feel unfair
before lav movement and blockers are implemented.

## Strike recovery tuning

The current 65% strike recovery target should remain the default starting point.
It creates relief from panic while preserving pressure. Keep it configurable so
playtests can compare more forgiving recovery values against harsher values that
leave the passenger close to another crisis.

## Future fields

Later milestones should add row exit timings, physical movement speed, beverage
service, turbulence events, weighted initial bladder distribution, and bot
tuning parameters.
