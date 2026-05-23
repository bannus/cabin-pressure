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

## Loss model

When a passenger reaches 100%, they enter panic. If they remain in panic past the
grace period, the flight receives a strike. The first implementation uses three
strikes as loss and flight duration as win.

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
