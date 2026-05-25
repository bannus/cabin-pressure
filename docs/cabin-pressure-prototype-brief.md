Great — with those answers, I’d design the prototype around a **deterministic, UI-agnostic real-time agent simulation** with enough physicality to create funny bottlenecks, but not so much fidelity that balancing becomes painful.

Working title: **Cabin Pressure**  
Design vibe: **Mini Metro meets toilet panic** — readable lanes, simple state icons, escalating chaos.

---

# 1. Core design pillars

## Pillar 1: Readable chaos
The game should begin with obvious tactical decisions:

> “Seat 12A is at 70%, send them to rear lav.”

Then gradually become:

> “12A needs out, but 12B stood up recently, the cart is blocking row 15, rear lav has a queue, turbulence might hit in 20 seconds, and a baby diaper event just started.”

The chaos should come from **interacting simple systems**, not complicated UI.

## Pillar 2: Physical comedy through logistics
The cabin is basically a tiny constrained traffic network. The fun is not just “meters fill”; it is that everyone is physically in everyone else’s way.

Important physical systems:
- seats
- rows
- aisle cells
- lavatory queues
- carts
- passengers passing each other
- stand-up / sit-down animations as gameplay time
- turbulence forcing everyone back

## Pillar 3: Individual control, group consequences
The player controls individuals, but every command affects other people.

Example:
- sending 18F means 18E and 18D may need to stand
- those blockers incur cooldowns
- they occupy aisle space
- they may slow down someone else
- they might become unavailable if seat belt sign comes on

## Pillar 4: Fast configurable experiments
The first engine should let you quickly answer questions like:
- Is player-initiated peeing fun?
- Is auto-requesting better?
- How full should meters start?
- How long should lav use take?
- How disruptive should beverage service be?
- Are 2-minute levels too short?
- Is a 3-lav plane easier than a 2-lav plane despite more passengers?

So the engine should be **data-driven** from the start.

---

# 2. Recommended prototype shape

I’d split the prototype into three layers:

```text
Core Simulation Engine
  Pure logic. Deterministic. No mobile dependencies.

Playtest Harness
  CLI or browser UI. Can run games, pause, inspect state, change speed.

Mobile Game Shell
  Later. Renders the same simulation and sends player commands.
```

The first useful milestone should not be a polished mobile app. It should be:

> A browser or CLI-playable simulation where you can run a tiny plane, click passengers, assign lavs, trigger drink service, force turbulence, and inspect whether the systems are fun.

Since you want Android and iOS eventually, I’d recommend either:

## Best stack recommendation: Godot 4 + pure engine module

Godot is a good fit because:
- exports to Android and iOS
- lightweight compared to Unity
- great for 2D board/diagram-like games
- easy to make a debug UI
- engine logic can be kept mostly independent
- fast iteration

However, for CLI and browser testing, Godot is slightly less ideal than TypeScript.

## Alternative recommendation: TypeScript core + browser first + mobile wrapper later

This may be better for your stated engine goals:
- UI-agnostic core
- easy deterministic tests
- browser playtesting
- simple automated sims
- possible mobile deployment later through Capacitor, React Native, Expo, or a native wrapper

For “vibe coding,” I’d probably choose:

> **TypeScript simulation core + lightweight browser playtest UI first.**

Then once the game is fun:
- either ship as a web-wrapped mobile game,
- or port the small deterministic engine to Godot/C# or GDScript.

My recommendation:

```text
Phase 1: TypeScript core engine + browser debugger.
Phase 2: If fun, either keep TS and wrap for mobile, or port to Godot.
```

---

# 3. Core game loop

Each level is a short flight segment.

## Player objective

> Survive until landing without accumulating too many bladder-failure strikes.

Initial loss model to test:

```text
If a passenger reaches 100 bladder:
  enter Panic state.
If they remain at 100 for N seconds:
  gain 1 strike.
  passenger resets to some embarrassed/recovered state or remains urgent depending on tuning.

Lose at 3 strikes.
Win when flight timer reaches 0.
```

Why not instant loss? Because instant loss may be too brittle in chaotic simulations. A strike system gives you more playtesting range.

## Core loop

1. Passengers’ bladder levels increase over time.
2. Beverage service increases future bladder pressure.
3. Player sends passengers to lavatories.
4. Passengers may need blockers to stand.
5. Aisle movement creates congestion.
6. Lavatory queues form.
7. Turbulence threatens movement.
8. Seat belt sign forces passengers back.
9. Player tries to keep everyone below disaster level until landing.

---

# 4. Simulation model

## World structure

Use a cabin grid/graph, not freeform movement.

```text
Aircraft
  rows[]
  aisleCells[]
  lavatories[]
  carts[]
  passengers[]
```

Each row has seats, probably like:

```text
Row 12:
  left seats: A B C
  aisle
  right seats: D E F
```

For v1, assume one aisle.

Each passenger has:
- seat position
- current location
- assigned route
- bladder meter
- archetype
- current state
- movement speed
- cooldowns
- lav use duration if currently using lav

---

# 5. Passenger archetypes for v1

Keep this very small.

## Normal passenger

Baseline values.

```text
bladderCapacity: 100
bladderRate: 1.0x
lavDuration: random 8–16s
patienceAtFull: 8s
```

## Small bladder passenger

```text
bladderCapacity: 75
bladderRate: 1.2x
lavDuration: random 8–16s
```

Small bladder passengers are not necessarily slower or more annoying; they just become urgent faster.

## Big bladder passenger

```text
bladderCapacity: 130
bladderRate: 0.85x
lavDuration: random 8–16s
```

## Baby-attached adult

Baby is a modifier attached to an adult/caregiver.

```text
adult has normal bladder rules
baby has diaper event timer
when diaper event occurs:
  caregiver needs lav/changing trip
  lavDuration: random 18–32s
```

For v1, I would **not** make the baby have its own physical entity. It adds a special bathroom task to the adult.

---

# 6. Bladder system

Each passenger has a bladder level from `0` to `100`, where `100` means crisis.

Internally, archetypes can have different capacity, but expose it as percentage to the UI.

```text
rawBladder += bladderFillRate * dt
displayBladder = rawBladder / capacity
```

## Beverage service

Beverage service should probably not instantly increase bladder. Instead, it should apply a delayed fill-rate modifier.

Example:

```text
When beverage cart services a row:
  each passenger in row receives beverageEffect:
    delay: 20–40s
    duration: 60–120s
    bladderRateMultiplier: +50%
```

This creates a wave of future bathroom needs after the cart passes.

That is better than a flat immediate increase because it creates predictable-but-chaotic timing.

---

# 7. Passenger states

A simple state machine will help a lot.

```text
Seated
NeedsToGo
RequestedByPlayer
WaitingForBlockers
StandingUp
EnteringAisle
WalkingToLav
QueuedForLav
UsingLav
ExitingLav
WalkingToSeat
WaitingToEnterRow
SittingDown
Panic
```

Could simplify early to:

```text
Seated
PreparingToLeaveSeat
WalkingToLav
QueuedForLav
UsingLav
ReturningToSeat
PreparingToSit
Panic
```

But because your row-blocker mechanic matters, I’d explicitly model:

```text
WaitingForBlockers
StandingUp
```

---

# 8. Player commands

For v1, support these commands:

## Command: Send passenger to lavatory

```text
GoToLav(passengerId, lavatoryId)
```

If passenger is seated:
1. Check if seat belt sign allows movement.
2. Identify blockers.
3. Ask blockers to stand.
4. Reserve or begin row-exit sequence.
5. Route passenger to lav.

If passenger is already queued or walking:
- reroute if allowed.

## Command: Ask row/seat blockers to stand

```text
AskToStand(passengerId)
```

This can be automatically triggered by `GoToLav`, but also exposed manually for testing.

For example, the player might pre-open a row before sending someone out.

## Command: Reorder lavatory queue

```text
SetQueuePriority(lavatoryId, passengerId, priorityIndex)
```

This is juicy because it gives the player a powerful intervention tool, but it can also create fairness/chaos.

## Command: Schedule future bathroom trip

This is worth testing, but I’d add it after the basic loop works.

```text
ScheduleGoToLav(passengerId, lavatoryId, triggerCondition)
```

Possible trigger conditions:
- when bladder exceeds X%
- when aisle path clears
- after current cart passes
- after seat belt sign turns off

For v1, keep it simple:

```text
QueueCommand(passengerId, lavatoryId)
```

Meaning:

> “When this passenger is allowed to leave, start going to this lav.”

This gives the player a lightweight planning tool without building a complex automation system.

---

# 9. Seat and blocker model

You said:
- detailed
- standing takes time
- standing blocks aisle
- standing incurs cooldown
- passengers physically enter aisle

So model each seat group as a small dependency chain.

For a six-seat row:

```text
A B C | aisle | D E F
```

To leave from:
- C or D: no blockers
- B: C must stand
- A: B and C must stand
- E: D must stand
- F: E and D must stand

When blockers stand:
1. They enter the aisle or row-adjacent holding position.
2. They occupy aisle space.
3. They become annoyed/cooldown-locked.
4. After the passenger exits, they return to seat.

## Cooldown

Each passenger has:

```text
lastStoodAt
standCooldownUntil
```

If asked to stand during cooldown:
- either refuse,
- or take longer,
- or increase penalty.

For v1 I’d do:

```text
Can stand if cooldown expired.
If not expired, row exit cannot begin.
```

This makes the rule legible.

Later you can test “reluctantly stands but slower.”

---

# 10. Aisle movement model

You want:
- one occupancy channel
- passengers can pass but both slow
- passengers cannot pass carts

Use aisle cells with soft occupancy.

```text
AisleCell:
  rowIndex
  occupants[]
  cartPresent?
```

Rules:
- 0 occupants: normal movement
- 1 occupant: normal movement
- 2 occupants passing opposite directions: both slowed
- cart present: blocked
- maybe max 2 human occupants for passing

For v1:

```text
If passenger and passenger conflict:
  movement speed *= 0.4 for both.
If passenger and cart conflict:
  no movement through that cell.
```

This gives you readable congestion without full collision simulation.

---

# 11. Lavatory model

Each lavatory has:

```text
Lavatory
  id
  position
  occupiedBy
  queue[]
```

Passenger flow:

```text
Walk to lav queue position
Join queue
When lav free and passenger first:
  enter lav
  use for randomized duration
  exit
  return to seat
```

## Random lav duration

Because you want deterministic seeds:

```text
lavDuration = seededRandomRange(min, max)
```

Normal:
```text
8–16 seconds
```

Baby diaper:
```text
18–32 seconds
```

Maybe small bladder does **not** affect duration at first.

## Rerouting

If player assigns a different lav:
- if walking: recompute route
- if queued: remove from old queue and path to new lav queue
- if using lav: cannot reroute
- if returning: command ignored unless future queue command exists

---

# 12. Beverage cart model

Beverage carts are physical blockers and scripted/semi-random events.

```text
Cart
  id
  aislePosition
  direction
  currentState:
    Inactive
    Moving
    ServingRow
    Paused
  serviceRows[]
```

Behavior:
1. Cart enters aisle.
2. Moves row by row.
3. Stops at row for service duration.
4. Applies beverage effect to that row.
5. Blocks aisle cell while present.
6. Passengers cannot pass it.

For v1, use one cart.

Configurable values:
```text
cartStartTime
cartDirection
cartMoveTimePerRow
cartServiceTimePerRow
beverageDelayRange
beverageRateMultiplier
beverageDuration
```

Debug commands:
```text
TriggerCart()
RemoveCart()
PauseCart()
```

---

# 13. Turbulence and seat belt sign

You want:
- visual turbulence indicator that may or may not lead to sign
- seat belt sign restricts movement
- seated can’t get up
- aisle/queue passengers return to seats
- bathroom passengers finish then return

This is a good system.

## Turbulence phases

```text
Calm
TurbulenceWarning
SeatBeltOn
Recovering
```

## During `TurbulenceWarning`

Movement still allowed.

UI shows:
- plane shake indicator
- captain warning light
- maybe countdown uncertainty

This creates tension:

> “Do I send 21A now, or wait?”

## During `SeatBeltOn`

Rules:
- seated passengers cannot start leaving
- passengers walking to lav are rerouted home
- passengers queued for lav are rerouted home
- passengers using lav finish, then return home
- carts probably pause in place or maybe crew secure cart

For v1, I’d pause carts in place, but that creates possible aisle blockage. That’s probably good chaos.

## Turbulence event config

```text
TurbulenceEvent:
  warningStartTime
  warningDuration
  chanceToBecomeSeatbelt
  seatbeltDuration
```

For scripted levels, you can provide exact events.

For semi-random levels, use:
```text
base events + seeded jitter
```

Example:
```json
{
  "warningStart": 70,
  "warningJitter": 15,
  "warningDuration": 8,
  "seatbeltChance": 0.75,
  "seatbeltDuration": [15, 30]
}
```

---

# 14. Level configuration

A level should be pure data.

Example rough JSON-ish structure:

```json
{
  "id": "tiny-hop-001",
  "name": "Short Hop",
  "durationSeconds": 180,
  "seed": 12345,

  "aircraft": {
    "rows": 12,
    "seatLayout": ["A", "B", "C", "D", "E", "F"],
    "aisles": 1,
    "lavatories": [
      { "id": "front", "row": 0 },
      { "id": "rear", "row": 13 }
    ]
  },

  "passengerMix": {
    "normal": 60,
    "smallBladder": 8,
    "bigBladder": 4,
    "babyAttachedAdults": 2
  },

  "bladder": {
    "initialFillRange": [0.05, 0.45],
    "baseFillPerSecond": 0.35
  },

  "lavatory": {
    "normalDuration": [8, 16],
    "babyDuration": [18, 32]
  },

  "rowExit": {
    "standTime": 1.5,
    "sitTime": 1.0,
    "standCooldown": 20
  },

  "movement": {
    "rowsPerSecond": 2.0,
    "passingSlowMultiplier": 0.4
  },

  "beverageService": [
    {
      "startTime": 30,
      "direction": "frontToRear",
      "serviceTimePerRow": 3,
      "moveTimePerRow": 1,
      "beverageDelay": [20, 40],
      "bladderRateMultiplier": 1.5,
      "duration": [60, 100]
    }
  ],

  "turbulence": [
    {
      "warningStart": 90,
      "warningJitter": 10,
      "warningDuration": 8,
      "seatbeltChance": 0.6,
      "seatbeltDuration": [15, 25]
    }
  ],

  "loss": {
    "panicGraceSeconds": 8,
    "maxStrikes": 3
  }
}
```

This gives you a strong basis for experimenting.

---

# 15. Engine architecture

Keep the sim deterministic and command-driven.

## Main pieces

```text
Simulation
  owns world state
  advances time
  applies commands
  emits events

WorldState
  aircraft
  passengers
  lavatories
  carts
  turbulence state
  timers
  random seed state

Systems
  BladderSystem
  MovementSystem
  SeatingSystem
  LavatorySystem
  CartSystem
  TurbulenceSystem
  CommandSystem
  LossSystem
```

## Main update loop

Pseudo-code:

```ts
function tick(sim: Simulation, dt: number) {
  sim.time += dt;

  applyQueuedCommands(sim);

  updateTurbulence(sim, dt);
  updateCarts(sim, dt);
  updateBladders(sim, dt);
  updatePassengerStateMachines(sim, dt);
  updateMovement(sim, dt);
  updateLavatories(sim, dt);
  updateLossAndWinConditions(sim, dt);

  emitEvents(sim);
}
```

## Determinism rules

To preserve deterministic seeds:
- use a seeded RNG only
- never use system time inside sim
- process passengers in stable ID order
- process commands in timestamp/order order
- keep fixed timestep for automated sims

Recommended fixed timestep:

```text
10 ticks per second
dt = 0.1
```

The UI can render smoothly, but the sim advances in fixed steps.

---

# 16. Minimal viable prototype

The first playable prototype should have only this:

## Aircraft
- one aisle
- 8–16 rows
- 2 lavatories
- six seats per row

## Passengers
- normal
- small bladder
- big bladder
- baby-attached adult

## Player actions
- select passenger
- send to selected lav
- reroute passenger
- reorder queue
- pause/speed up
- force cart
- force turbulence

## Systems
- bladder fill
- seated/standing/aisle movement
- lav queues
- row blockers
- cart blocking
- seat belt sign
- strikes
- win at landing

## Debug display
- passenger bladder %
- passenger state
- lav queues
- cart position
- turbulence state
- current seed
- active commands
- strike count

Do **not** build:
- polished art
- unlocks
- sound
- special passenger zoo
- detailed scoring
- accident presentation
- tutorials
- monetization
- leaderboards

Not yet.

---

# 17. Prototype visual style

For the browser playtest UI, use a schematic grid.

Example:

```text
       LAV
  A B C | D E F
1 🟩🟨🟩 | 🟩🟥🟩
2 🟩🟩🟩 | 🟨🟩🟩
3 🟩🟩🟥 | 🟩🟩🟩
        |
       CART
        |
4 🟩🟩🟩 | 🟩🟧🟩
5 🟩🟥🟩 | 🟩🟩🟩
       LAV
```

Use colors:
- green: safe
- yellow: medium
- orange: urgent
- red: panic
- blue: moving
- purple: baby event
- gray: blocked/cooldown

A passenger in aisle could appear as a small token between rows.

The point is to make the system inspectable, not beautiful.

---

# 18. Automated simulation mode

You said yes to automated runs for tuning. This is important.

Add a simple bot player that can run thousands of seeded simulations.

## Basic bot strategy v1

Every few seconds:
1. Find passengers over urgency threshold.
2. Prefer passengers already aisle-adjacent.
3. Assign them to lav with shortest estimated wait.
4. Avoid sending inner-seat passengers if blockers are on cooldown.
5. During turbulence warning, become more conservative.
6. During seat belt sign, send no one.

The bot does not need to be good. It needs to be consistent.

## Metrics to log

You said you don’t care about score yet, just fun/winnability. So log tuning metrics:

```text
win/loss
strikes
max simultaneous panic passengers
average bladder %
max queue length
average lav wait
aisle congestion time
cart-blocked passenger-seconds
seatbelt-forced-return count
commands issued
```

This lets you answer:

> “Is this level impossible because the player is bad, or because lav capacity is mathematically insufficient?”

---

# 19. Important design question: player-initiated vs passenger-initiated

You were thinking player-initiated, but open to both. I would build the engine to support both, but test in this order:

## Mode A: Player-initiated only

Passengers do not ask. The player watches meters and decides.

Pros:
- strategic
- more like time-management
- cleaner UI
- player feels responsible

Cons:
- may become meter whack-a-mole
- less personality
- easy to miss people

## Mode B: Passenger requests

At some bladder threshold, passengers request permission.

Example:
```text
At 70%, passenger becomes Requesting.
At 90%, passenger becomes Desperate.
```

Pros:
- more readable
- creates funny “please let me go” moments
- helps mobile UX

Cons:
- may reduce player planning
- could become notification spam

## Recommended default for first playtest

Use hybrid:

```text
Player can send anyone at any time.
Passengers also request at 70%.
```

This gives you both:
- proactive planning
- reactive crisis management

You can disable requests in config.

---

# 20. The key unknowns to playtest

These are the design variables I would avoid deciding permanently right now.

## Unknown 1: How harsh should inner seats be?

Too harsh:
- window-seat passengers are doomed
- player feels punished by RNG

Too soft:
- seat layout barely matters

Tune:
```text
standTime
sitTime
standCooldown
cooldown refusal vs slower compliance
```

## Unknown 2: Should lav queues be player-managed?

Queue reordering may be very fun, but also fiddly on mobile.

Test:
- no queue reordering
- drag reorder
- emergency priority button
- automatic queue sorted by urgency

## Unknown 3: How much randomness is funny?

Random lav times are good, but if too wide they may feel unfair.

Start with:
```text
normal lav: 8–16s
baby lav: 18–32s
```

Avoid:
```text
normal lav: 5–45s
```

At least until the rest of the game is stable.

## Unknown 4: What should happen at 100%?

Test three options:

### Option A: strike after grace period
Most forgiving.

### Option B: immediate strike, no instant loss
Arcade-ish.

### Option C: accident creates a blocked seat/row
More simulation-y, but potentially gross or tonally weird.

For now, I’d implement A.

## Unknown 5: Is 2–5 minutes right?

Probably yes, but you may discover that:
- 2 minutes is too short for beverage waves
- 5 minutes is too long for mobile chaos

Good early targets:
```text
Tiny tutorial: 90s
Normal level: 180s
Hard level: 240s
```

---

# 21. Suggested milestone roadmap

## Milestone 0: Pure data model

Goal: create and print a cabin.

Features:
- aircraft layout config
- passenger generation
- seeded RNG
- bladder levels
- no movement yet

Success:
```text
Given same seed and config, same passengers are generated every time.
```

---

## Milestone 1: Bladder and win/loss sim

Goal: simulate urgency over time.

Features:
- bladder fill
- archetypes
- panic
- strikes
- landing win condition
- CLI output

No player movement yet.

Success:
```text
Can run a 180s flight and see who would fail without intervention.
```

---

## Milestone 2: Lavatory assignment without physical seats

Goal: make the basic bathroom economy work.

Features:
- command: send passenger to lav
- walking time abstracted by row distance
- lav queues
- lav duration
- return to seat
- rerouting

Success:
```text
Can keep passengers alive by assigning lavs.
```

---

## Milestone 3: Physical aisle movement

Goal: add spatial bottlenecks.

Features:
- aisle cells
- passenger movement
- passing slowdown
- lav queue positions

Success:
```text
Congestion naturally forms near lavatories.
```

---

## Milestone 4: Seat blockers

Goal: make seat position matter.

Features:
- inner-seat dependencies
- blockers stand into aisle
- stand/sit timers
- stand cooldowns

Success:
```text
Window seats are strategically harder but not impossible.
```

---

## Milestone 5: Beverage cart

Goal: add a moving blocker and delayed bladder wave.

Features:
- physical cart
- row service
- beverage bladder-rate modifier
- debug trigger

Success:
```text
Drink service causes a predictable future surge of bathroom demand.
```

---

## Milestone 6: Turbulence and seat belt sign

Goal: add timed disruption.

Features:
- warning phase
- possible seat belt sign
- forced returns
- movement lockout
- debug trigger

Success:
```text
Player has meaningful risk/reward decisions during turbulence warning.
```

---

## Milestone 7: Baby diaper events

Goal: add first special constraint.

Features:
- baby-attached adult archetype
- diaper event timer
- long lav usage
- baby indicator

Success:
```text
Baby events create scary lav occupancy without introducing a whole new entity system.
```

---

## Milestone 8: Browser playtest UI

You can start the browser UI earlier, but by this point you need:
- clickable seats/passengers
- lav assignment
- queue view
- time controls
- debug buttons
- config picker
- seed input

Success:
```text
You can play multiple configs quickly and decide what is fun.
```

---

## Milestone 9: Automated bot runs

Goal: test winnability.

Features:
- simple AI player
- batch simulation
- CSV/JSON result output
- compare configs

Success:
```text
You can run 1,000 seeded flights and see win rate by config.
```

---

# 22. Recommended first level configs

## Level A: Tiny readable cabin

Purpose: test core loop.

```text
Rows: 8
Seats: 4 per row, A B | C D
Lavatories: 1 front, 1 rear
Passengers: 32
Duration: 120s
No babies
No cart
No turbulence
```

If this is not fun, do not add complexity yet.

---

## Level B: Standard chaos seed

Purpose: test actual premise.

```text
Rows: 14
Seats: 6 per row
Lavatories: 1 front, 1 rear
Passengers: 84
Duration: 180s
Small bladder: 10%
Big bladder: 10%
Babies: 2
One beverage cart
One turbulence warning
```

---

## Level C: Cart nightmare

Purpose: test beverage/cart drama.

```text
Rows: 20
Seats: 6 per row
Lavatories: 2 rear, 1 front
Duration: 240s
Beverage cart starts early
Turbulence warning near beverage aftermath
```

---

# 23. A strong initial ruleset

If I had to pick first-playtest values:

```text
Flight duration: 180s
Base bladder fill: reaches full in about 220s for normal passenger
Initial bladder: 5–45%
Small bladder capacity: 75%
Big bladder capacity: 130%
Normal lav duration: 8–16s
Baby lav duration: 18–32s
Walk speed: 2 rows/sec
Passing speed multiplier: 0.4
Stand time: 1.5s
Sit time: 1.0s
Stand cooldown: 20s
Panic threshold: 100%
Panic grace: 8s
Strikes to lose: 3
Passenger request threshold: 70%
Desperate visual threshold: 90%
```

This should create urgency without immediately becoming impossible.

---

# 24. Open design decisions I would defer

I would **not** decide these yet:

1. Accident presentation.
2. Whether passengers ask automatically or only show meters.
3. Whether queue reordering survives mobile UX.
4. Whether blockers refuse during cooldown or merely complain.
5. Whether carts can be controlled by the player.
6. Whether turbulence should increase bladder/stress.
7. Final scoring model.
8. Passenger personalities beyond basic archetypes.

Keep the prototype flexible enough to test them.

---

# 25. Immediate next step

I’d suggest we next define the **engine entities and data schemas** in detail.

Specifically:
1. `AircraftConfig`
2. `LevelConfig`
3. `Passenger`
4. `Seat`
5. `AisleCell`
6. `Lavatory`
7. `Cart`
8. `TurbulenceEvent`
9. `Command`
10. `GameState`

Then we can turn that into either:
- a TypeScript project skeleton,
- a Godot-oriented architecture,
- or a plain-language implementation spec.

My recommendation for your stated goal:

> Build a TypeScript core simulation with a browser debug UI first. Keep it deterministic, data-driven, and mobile-portable later.
