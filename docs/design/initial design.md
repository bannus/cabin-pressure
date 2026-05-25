# Initial design

This document captures the full original prototype brief in one place, including
details that are only partially represented across the existing design docs.

## 1) Full initial brief (consolidated)

### Design pillars

1. **Readable chaos** from simple interacting systems, not complicated UI.
2. **Physical comedy through logistics**: seats, aisle cells, blockers, carts,
   queues, and turbulence create bottlenecks.
3. **Individual control with group consequences**: commanding one passenger
   affects blockers, cooldowns, aisle occupancy, and queue outcomes.
4. **Fast configurable experiments**: tune system behavior through level data,
   not code rewrites.

### Recommended prototype shape

- Deterministic, UI-agnostic simulation core.
- Playtest harness (CLI and/or browser debugger).
- Mobile shell later.
- Preferred path: **TypeScript core + browser debugger first**, then either
  mobile web wrapper or later Godot port once fun is proven.

### Core loop

- Bladder meters fill over time.
- Beverage service creates delayed bladder pressure waves.
- Player sends passengers to lavatories.
- Blockers stand and can create congestion.
- Aisle movement and queues create bottlenecks.
- Turbulence warning may become seat belt lockout.
- Seat belt sign forces non-lav passengers back.
- Win at landing timer, lose on strike threshold.

### World and entity model

- Aircraft with rows, aisle cells, lavatories, carts, passengers.
- One-aisle v1 layout.
- Rows logically modeled as seat groups around aisle (example: `A B C | D E F`).
- Deterministic seeded randomness only.

### Passenger archetypes (v1)

- Normal (capacity 100, baseline fill rate).
- Small bladder (capacity 75, faster fill).
- Big bladder (capacity 130, slower fill).
- Baby-attached adult (normal bladder plus diaper-event lav tasks with longer
  duration).

### Bladder model

- Internal raw bladder with per-archetype capacity; UI shows percentage.
- Threshold framing:
  - request around 70%
  - desperate around 90%
  - panic at 100%
- Suggested panic model: strike after grace period, not instant loss.

### State machine direction

State granularity expected for design flexibility:

- `Seated`
- `NeedsToGo`
- `RequestedByPlayer`
- `WaitingForBlockers`
- `StandingUp`
- `EnteringAisle`
- `WalkingToLav`
- `QueuedForLav`
- `UsingLav`
- `ExitingLav`
- `WalkingToSeat`
- `WaitingToEnterRow`
- `SittingDown`
- `Panic`

### Command set proposed in brief

- `GoToLav(passengerId, lavatoryId)`
- `AskToStand(passengerId)` (manual blocker prep option)
- `SetQueuePriority(lavatoryId, passengerId, priorityIndex)`
- Lightweight deferred scheduling (`QueueCommand(passengerId, lavatoryId)`)

### Seat blocker model

For six-seat rows:

- `C`/`D`: no blockers
- `B`: `C` must stand
- `A`: `B` and `C` must stand
- `E`: `D` must stand
- `F`: `E` and `D` must stand

Standing/sitting should consume time, occupy aisle/holding space, and apply
cooldown effects.

### Aisle movement model

- Aisle cells with soft occupancy.
- Passenger-passenger passing allowed but both slowed.
- Passengers cannot pass carts.
- Suggested starting rule: passing applies speed multiplier (example 0.4).

### Lavatory model

- Per-lavatory queue and occupancy.
- Deterministic randomized use durations:
  - normal: ~8–16s
  - baby/diaper task: ~18–32s
- Rerouting allowed while walking/queued; disallowed while using lav.

### Beverage cart model

- Physical blocker moving row-by-row.
- Services rows over time and applies delayed bladder-rate effects.
- Debug controls proposed: trigger, pause, remove.

### Turbulence model

Phases proposed:

- `Calm`
- `TurbulenceWarning`
- `SeatBeltOn`
- `Recovering`

Rules:

- Warning phase allows movement.
- Seat belt phase blocks new departures, forces walkers/queues home, allows
  current lav users to finish then return.
- Config intended to support scripted and seeded-jitter variants.

### Level data-driven configuration intent

Brief expects level data to cover aircraft topology, passenger mix, bladder
rates and initialization, lav timing, row exit timings, movement, cart events,
turbulence events, and loss rules.

### Engine architecture intent

- Deterministic command-driven simulation core.
- World state + explicit systems:
  `Bladder`, `Movement`, `Seating`, `Lavatory`, `Cart`, `Turbulence`,
  `Command`, `Loss`.
- Tick loop with stable processing order.
- Recommended fixed timestep: `dt = 0.1` (10 ticks/s).

### MVP scope (what to include / avoid)

Include:

- one-aisle aircraft
- two lavatories minimum
- four archetypes including baby-attached adult
- assignment/reroute controls
- queue visibility
- cart and turbulence debug controls
- strikes and flight-timer win/loss

Defer:

- polished art/audio
- progression/monetization/leaderboards
- deep personality systems

### Automated simulation mode intent

Expected:

- consistent bot policy
- batch seeded runs
- tuning metrics (win/loss, strikes, panic concurrency, queue lengths, waits,
  congestion time, blocked passenger-seconds, forced returns, command count)

### Player-initiated vs passenger-request modes

Brief guidance:

- support both
- first playtest default should be hybrid:
  player can send anyone anytime, passengers also request around threshold.

### Staged milestone roadmap intent

Milestones 0–9 in order:

0) data model,  
1) bladder + win/loss,  
2) lav economy (abstract movement),  
3) physical aisle,  
4) seat blockers,  
5) cart + delayed bladder wave,  
6) turbulence + seat belt constraints,  
7) baby diaper events,  
8) browser playtest UI expansion,  
9) automated bot runs.

### Recommended first playable configs and defaults

Brief provided suggested level set (tiny readable, standard chaos, cart-heavy)
and baseline values (durations, rates, cooldowns, thresholds, strike rules) as
initial tuning anchors, not final balance decisions.

### Deliberately deferred design decisions

- accident presentation
- final request/notification model
- queue-reorder UX viability on mobile
- cooldown refusal vs slowdown behavior
- cart controllability by player
- turbulence side-effects beyond movement limits
- final scoring
- deeper personalities

### Immediate follow-up schema design target

Explicitly define:

- `AircraftConfig`
- `LevelConfig`
- `Passenger`
- `Seat`
- `AisleCell`
- `Lavatory`
- `Cart`
- `TurbulenceEvent`
- `Command`
- `GameState`

---

## 2) Comparison with implemented code (meaningful gaps)

Status below reflects current TypeScript implementation in `src/`, CLI, and
browser debugger.

### Implemented and aligned

- Deterministic seeded TypeScript simulation core.
- CLI and browser debugger playtest harnesses.
- Core bladder, panic, strike, win/loss model.
- Lavatory assignment + rerouting before use.
- Physical aisle rows, queue positions, and cart blocking.
- Seat blockers with stand/sit/cooldown behavior.
- Turbulence warning + optional seat belt activation + forced returns.
- Baby diaper events with longer lavatory occupancy.

### Meaningful differences or missing features

1. **No explicit command-system API from brief**
   - Missing explicit `GoToLav` command queue abstraction with timestamps.
   - Missing explicit `AskToStand` command.
   - Missing `SetQueuePriority` (manual lav queue reordering).
   - Missing deferred `QueueCommand(passengerId, lavatoryId)` scheduling.

2. **State machine is simpler than full brief**
   - Current states do not include detailed transitional states such as
     `RequestedByPlayer`, `EnteringAisle`, `ExitingLav`, `WaitingToEnterRow`,
     or `Recovering`.

3. **Turbulence phase model differs**
   - Implemented phases are `idle`, `warning`, `active`.
   - Brief proposed a 4-phase model (`Calm`, `Warning`, `SeatBeltOn`,
     `Recovering`) and more explicit uncertainty/jitter event semantics.

4. **Beverage-effect variability is narrower**
   - Implementation uses scalar `bladderRateDelaySeconds` and
     `bladderRateDurationSeconds`, not per-row randomized delay/duration ranges
     as described in the brief examples.

5. **Cart debug controls are partial**
   - Start trigger exists.
   - Pause/remove controls described in the brief are not exposed as dedicated
     engine or UI commands.

6. **Automated bot-run milestone is not implemented**
   - No built-in bot strategy, batch runner, or structured CSV/JSON batch output
     flow for large seeded sweeps.

7. **Metrics coverage is partial**
   - Runtime summary exists, but the full proposed tuning metric set (for
     example cart-blocked passenger-seconds and forced-return aggregates across
     batch experiments) is not yet delivered as an automated analysis pipeline.

8. **Mode toggles are not fully exposed**
   - Hybrid behavior exists (players can assign proactively, and passengers can
     enter need/request-like states), but explicit config-level mode switching
     between strict player-initiated-only vs request-driven flows is limited.

9. **Config shape diverges from brief’s richer event arrays**
   - Current config supports one turbulence config object and one cart config.
   - Brief examples describe richer multi-event arrays and jitter fields for
     scripted/semi-random event programs.

10. **Default tuning differs from suggested baseline**
    - Several values are intentionally milder in current config (for example
      smaller seat layout, shorter blocker cooldown, narrower lav durations),
      so current defaults are not a direct copy of the brief’s first-pass values.

11. **Entity schema checklist not fully explicit in public types**
    - `Command` and explicit `Seat` entities are not modeled as first-class
      public types in the same way the brief suggested.

