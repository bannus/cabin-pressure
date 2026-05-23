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

When a passenger reaches 100%, they enter panic. If they remain in panic past the
grace period, the flight receives a strike. The first implementation uses three
strikes as loss and flight duration as win.

After a strike, the current default recovery target is 65% bladder. This is a
reasonable starting point because it breaks the immediate panic loop without
making the problem disappear. Keep `strikeRecoveryFillPercent` documented as a
tuning knob; alternate playtests may reset lower for forgiveness or keep the
passenger more urgent for sustained pressure.

## Later systems

Future milestones add:

- lavatory assignment and queues
- aisle cells and passing slowdown
- seat blockers and cooldowns
- beverage cart blocking and delayed bladder-rate effects
- turbulence warning, seat belt sign, and forced returns
- baby diaper tasks
- browser playtest UI
- automated bot simulations
