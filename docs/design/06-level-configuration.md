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
- `lavatory.passingSlowdownMultiplier`
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

Two additional options are available if urgency density still feels too
synchronized after tuning the range and rate:

**Option: skewed initial fill distribution.** Instead of sampling uniformly
within `initialFillRange`, apply a power curve to the raw RNG value before
scaling (e.g. `Math.pow(r, 2)`) so that most passengers start near empty and
only a few start near the ceiling. This keeps the range endpoints unchanged
while clustering fills toward the low end. Would require a small change to
`createInitialState` in `simulation.ts` and a new `initialFillSkew` config
field.

**Option: per-passenger fill onset delay.** Give each passenger a random latent
period (e.g. 0–90 s) before their bladder starts filling at all. Early in the
flight nearly nobody needs to go; urgency builds gradually as each passenger's
timer expires. Would require a new `fillOnsetSeconds` field on `Passenger` and
a guard in `updatePassengerBladder` that skips fill while `state.time` is below
the threshold. A `bladder.fillOnsetRange` config field would control the
spread.

## Strike recovery tuning

The current 65% strike recovery target should remain the default starting point.
It creates relief from panic while preserving pressure. Keep it configurable so
playtests can compare more forgiving recovery values against harsher values that
leave the passenger close to another crisis.

## Future fields

Later milestones should add row exit timings, physical movement speed, beverage
service, turbulence events, weighted initial bladder distribution, and bot
tuning parameters.
