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
- `bladder.initialFillDistribution` (optional weighted ranges; supersedes uniform range)
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

## Current playtest: The Drinks Run

`pressureFlight` in `src/config.ts` is the browser default. The legacy level
below remains a separate regression fixture, not the current balance target.

- 4 rows, 16 passengers, two loos, 120 seconds, default seed 42
- initial fill weights: 5 at 15–40%, 3 at 40–65%, 2 at 65–78%
- request at 65%; baseline normal fill time 180 seconds; 8-second panic grace
- loo visits 8–12 seconds; caregiver visits 20–24 seconds
- cart service 17–19 seconds per row; 2 seconds per parking/resume maneuver
- all 16 passengers must be served by landing
- warning at 45 seconds; mandatory seat belts at 65 seconds for 10 seconds
- one caregiver call at 22–32 seconds, with 45 seconds to reach a loo
- three strikes lose; strike recovery 30%; repeat diaper call beyond this flight

Additional configuration fields:

- `beverageCart.requiredPassengersServed` (default 0, preserving legacy survival-only levels)
- `beverageCart.maneuverSeconds` (default 2 for cart commands)
- `babyDiaper.patienceSeconds` (omitted means no diaper timeout in legacy levels)

### Tuning procedure and results

`npm run tune -- --sweep --seeds 50 --json` compares 160/180/200-second
normal fill times and 8–12/10–14/12–16-second loo durations. Further
experiments compared 6/8/10-second grace and 15–17/17–19-second row service
on seeds 1000–1099. Longer loo visits tended to saturate the rush without
reliably increasing the advantage of planning; the selected scenario uses
short visits and a tighter cart budget instead.

Each policy can issue at most one command every two seconds, including
cart commands. Reactive dispatch uses requests and nearest distance;
assisted dispatch uses the same route suggestions as the browser.
The planner dispatches by estimated deadline, accounts for inbound loo
reservations and the warning, and parks when endangered traffic crosses the
cart, while preserving service slack. It uses no future RNG draws.

Final comparison, **200 additional seeds 10000–10199**, reproducible with
`npm run tune -- --seeds 200 --base-seed 10000`:

| Policy | Wins | Clean wins | Mean strikes | Mean commands |
|---|---:|---:|---:|---:|
| Hands-off | 0/200 | 0/200 | 3.00 | 0 |
| Reactive nearest loo | 180/200 | 52/200 | 1.19 | 21.72 |
| Reactive UI-assisted routing | 174/200 | 55/200 | 1.21 | 21.86 |
| Planner with cart control | 195/200 | 164/200 | 0.25 | 21.86 |
| Planner, never park | 144/200 | 40/200 | 1.58 | 12.21 |
| Planner, permanently parked | 0/200 | 0/200 | 0.01 | 11.37 |

Permanent parking loses on service, not bladder pressure. The planner's
mean loo occupancy per 30-second window is 36%, 82%, 52%, 37%, indicating
a rush and recovery rather than whole-flight saturation. Mean parking is
15.24 seconds; longest observed queue is three vs four for assisted play.
There is an initial call within 10 seconds in the tested sample.

Seed 42 is a forgiving first flight: the planner has a clean landing with
20 commands, and nearest-loo reactive play survives with one strike and
21 commands. In the browser, assisted reactive play can also clear this seed
cleanly. Retry and next-seed controls let players explore beyond this opener.

These are deterministic policy comparisons, not evidence of human enjoyment.
Human playtests should check whether players understand why a trip failed,
notice the parking/service tradeoff, choose to hold or release passengers
differently on retry, and want another flight. Survival is intentionally
forgiving; clean flights are the mastery target.

## First implemented (legacy) level

`tiny-readable-cabin`:

- 8 rows
- 4 seats per row
- 2 lavatories in config for future milestones
- 32 passengers
- 180 seconds
- normal, small bladder, big bladder, and baby-attached adult archetypes
- beverage cart is configured but starts only when triggered
- turbulence is configured with a warning, possible seat belt sign, and auto-start
- baby diaper events are configured with first/repeat timing and long change duration

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

## Lavatory demand budget and variability

For fast level tuning, compare estimated lavatory demand against ideal lavatory
supply:

- `demandSeconds`: expected total lavatory task time demanded by passengers
- `supplySeconds`: `durationSeconds * lavatoryCount` under perfect utilization
- `demandRatio`: `demandSeconds / supplySeconds`

The CLI prints this estimate at startup. As a rough rule:

- `< 0.7`: forgiving
- `0.7–0.95`: tense
- `> 0.95`: near overload
- `> 1.0`: overloaded on paper even before movement and queue friction

Because several inputs are sampled from ranges, demand varies by seed/sample.
When reporting variability, include both:

- **95% CI of the mean demand** (estimation uncertainty of the average), and
- **empirical 95% demand range** (typical run-to-run spread).

Reference values for current `tiny-readable-cabin` tuning (Monte Carlo sample):

- mean demand: `120.74s`
- 95% CI of mean demand: `[120.70s, 120.78s]`
- empirical 95% demand range: `[106.35s, 147.52s]`
- mean demand ratio: `0.335`
- empirical 95% demand-ratio range: `[0.295, 0.410]`

Use these as a baseline sanity check, not a strict balance target; real
difficulty is usually higher once assignment behavior, movement conflicts, and
timing mistakes are included.

## Future fields

Possible future experiments include seatmate batch release and alternate
aircraft layouts. Weighted fills and command-rate-limited policy comparisons
are implemented; additional simulation complexity should wait for human
feedback on the current short scenario.

## Future improvement candidates (demand variability)

If level-to-level or seed-to-seed demand swings are too large, keep randomness
but reduce budget variance with one or more of these options:

- **Stratified initial fill sampling.** Replace fully independent initial-fill
  draws with bucketed draws plus jitter so cabin-wide urgency is less volatile.
- **Mean correction pass.** After random initial fills are sampled, apply a
  small global offset so the cabin average tracks a target value.
- **Variance scaling knobs.** Add config multipliers to narrow or widen
  randomness for high-impact systems (`initialFillRange`, lavatory use duration,
  baby diaper timing) per level.
- **Quantile-based duration draws.** Sample lavatory and diaper durations from
  spread quantiles each run rather than unconstrained independent draws.
- **Separate budget RNG from presentation RNG.** Keep aggregate demand bounded
  while preserving local variation and flavor.

Before adopting a method globally, compare baseline vs candidate levels using:

- mean demand ratio
- empirical 95% demand-ratio range
- downstream gameplay outcomes (queue length, panic counts, strike rate)
