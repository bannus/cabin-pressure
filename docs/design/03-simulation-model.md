# Simulation model

## World structure

```text
Aircraft
  rows[]
  aisleCells[]
  lavatories[]
  carts[]
  passengers[]
```

The v1 aircraft uses one aisle. Rows contain left seats, an aisle, and right
seats, such as `A B C | D E F`.

## Passenger fields

- seat position
- current location
- bladder value and capacity
- archetype
- current state
- movement speed
- cooldowns
- assigned route
- lavatory use timer

## Passenger archetypes

- Normal: capacity 100, baseline fill rate.
- Small bladder: capacity 75, 1.2x fill rate.
- Big bladder: capacity 130, 0.85x fill rate.
- Baby-attached adult: adult uses normal bladder rules; later milestones add
  diaper events with long lavatory tasks.

## Milestone 1 subset

Milestone 1 models only deterministic passengers, bladder fill, request state,
panic state, strikes, win, and loss. Movement, lavatory queues, carts,
turbulence, and baby diaper events are documented for later milestones.
