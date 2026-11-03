# Systems and rules

## Bladder

Passengers expose bladder as a percentage while archetypes use different raw
capacities. Fill is deterministic:

```text
rawBladder += baseFillPerSecond * archetypeMultiplier * dt
displayBladder = rawBladder / capacity
```

Suggested thresholds:

- request: 70%
- desperate visual: 90%
- panic: 100%

## Initial bladder distribution

Prefer a configurable weighted distribution over a single uniform range for
playtest levels. A plain `5%–45%` range is deterministic and simple, but it can
make passengers feel synchronized and game-like. Real passengers would board with
more varied conditions because not everyone uses the bathroom immediately before
boarding.

Recommended first distribution:

- most passengers: 0%–45%
- some passengers: 45%–80%
- rare passengers: 80%–95%

Keep a simple uniform range available for focused deterministic tests, but use
weighted distributions for fun-oriented playtests. Later, archetypes can bias the
distribution: small-bladder passengers may skew higher, big-bladder passengers
may skew lower, and personality variants could request help earlier or later.

## Loss model

At 100%, a passenger's independent panic clock starts. Standing, walking,
queueing, rerouting, and forced returns do not reset it or erase a trip.
The `Panic` state is used for seated passengers; moving passengers retain
their locomotion state and expose urgency through bladder/panic fields.
Entering a loo stops the clock. Exceeding grace causes a strike and resets
bladder to the configured recovery value. Same-destination commands are
idempotent; rerouting happens from the current aisle position.

Three strikes lose the default flight. Landing wins only if any configured
drink-service quota is also complete. These rules are shared by browser,
CLI, and automated play.

After a strike, the current default recovery target is 65% bladder. This is a
reasonable starting point because it breaks the immediate panic loop without
making the problem disappear. Keep `strikeRecoveryFillPercent` documented as a
tuning knob; alternate playtests may reset lower for forgiveness or keep the
passenger more urgent for sustained pressure.

## Tactical playtest rules

The Drinks Run uses a 30% strike recovery target instead of the legacy 65%,
so a mistake creates breathing room rather than an immediate repeat task.
Its weighted initial fills stagger demand across a four-row cabin.

The cart can be pulled aside from its current row: it no longer blocks
passengers, but service stops. Parking and resuming each cost a configurable
two-second maneuver; commands cannot interrupt a maneuver. Turbulence
automatically stows the cart and freezes service without changing the
player's parked setting. Service counts unique passengers, not repeated rows.
All 16 passengers need drinks before landing.

The 20-second turbulence warning allows scheduling a trip into a loo before
the sign. A passenger already inside can finish. All other outbound trips
are canceled with physical returns; their urgency clocks continue.

Diaper calls have a configurable patience deadline. Getting into a loo
suspends it; neglect causes a strike. The long visit competes with short
bladder trips for the same capacity.

Time-to-trouble estimates include fill rate, known delayed beverage modifiers,
remaining panic grace, and active diaper deadlines. Loo entry estimates
include standing, distance, current cart delay, and other assigned passengers
including those not yet queued. They are estimates, not guaranteed ETAs:
traffic, future service, random visit length, and forced returns can change them.

## Implemented systems

The simulation includes:

- lavatory assignment and queues
- aisle cells and passing slowdown
- seat blockers and cooldowns
- beverage cart blocking and delayed bladder-rate effects
- turbulence warning, seat belt sign, and forced returns
- baby diaper tasks
- browser playtest UI
- automated bot simulations
