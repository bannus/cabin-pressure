import { ARCHETYPES } from "./archetypes";
import { SeededRng } from "./rng";
import type {
  AisleCell,
  BeverageCart,
  Lavatory,
  LevelConfig,
  Passenger,
  PassengerArchetype,
  PassengerState,
  PassengerUrgency,
  SimulationEvent,
  SimulationState,
  SimulationSummary,
  Turbulence
} from "./types";

const ARCHETYPE_ORDER: PassengerArchetype[] = [
  "normal",
  "smallBladder",
  "bigBladder",
  "babyAttachedAdult"
];

export function createInitialState(config: LevelConfig): SimulationState {
  validateConfig(config);

  const rng = new SeededRng(config.seed);
  const seats = buildSeats(config);
  const archetypes = rng.shuffle(buildArchetypeList(config, seats.length));
  const passengers = seats.map((seat, index): Passenger => {
    const archetype = archetypes[index] ?? "normal";
    const definition = ARCHETYPES[archetype];
    const initialFillPercent = rng.range(
      config.bladder.initialFillRange[0],
      config.bladder.initialFillRange[1]
    );

    return {
      id: `P${String(index + 1).padStart(3, "0")}`,
      row: seat.row,
      seat: seat.seat,
      archetype,
      capacity: definition.capacity,
      bladderRateMultiplier: definition.bladderRateMultiplier,
      rawBladder: definition.capacity * initialFillPercent,
      state: initialFillPercent >= config.bladder.requestThreshold ? "NeedsToGo" : "Seated",
      panicSeconds: 0,
      strikeCount: 0,
      assignedLavatoryId: undefined,
      aisleRow: undefined,
      destinationAisleRow: undefined,
      movementStepSecondsRemaining: 0,
      movementSecondsRemaining: 0,
      lavatorySecondsRemaining: 0,
      lavatoryVisitCount: 0,
      queuePosition: undefined,
      standSecondsRemaining: 0,
      sitSecondsRemaining: 0,
      standCooldownSecondsRemaining: 0,
      blockingPassengerId: undefined,
      beverageRateMultiplier: 1,
      beverageRateModifierStartSeconds: undefined,
      beverageRateModifierEndSeconds: undefined,
      babyDiaperSecondsRemaining:
        archetype === "babyAttachedAdult" && config.babyDiaper !== undefined
          ? babyDiaperEventSeconds(config, `first:${index + 1}`)
          : undefined,
      babyDiaperNeedsChange: false,
      babyDiaperChangeCount: 0
    };
  });

  const state: SimulationState = {
    config,
    time: 0,
    status: "running",
    strikes: 0,
    passengers,
    aisleCells: buildAisleCells(config, passengers),
    lavatories: config.aircraft.lavatories.map((lavatory) => ({
      id: lavatory.id,
      row: lavatory.row,
      queue: []
    })),
    beverageCart: buildBeverageCart(config),
    turbulence: buildTurbulence(config),
    events: []
  };

  refreshAisleCells(state);
  if (config.beverageCart?.autoStart === true) {
    startBeverageCart(state);
  }

  return state;
}

export function tick(state: SimulationState, dt: number): SimulationState {
  if (!Number.isFinite(dt) || dt <= 0) {
    throw new Error("dt must be a positive finite number");
  }

  if (state.status !== "running") {
    return state;
  }

  const elapsedSeconds = Math.min(dt, state.config.durationSeconds - state.time);
  state.time = Math.min(state.time + elapsedSeconds, state.config.durationSeconds);

  updateLavatoryProgress(state, elapsedSeconds);

  for (const passenger of state.passengers) {
    if (passenger.state === "UsingLavatory") {
      continue;
    }

    const lost = updatePassengerBladder(state, passenger, elapsedSeconds);
    if (lost) {
      break;
    }
  }

  if (state.status === "running" && state.time >= state.config.durationSeconds) {
    state.status = "won";
    addEvent(state, "win", `Landed with ${state.strikes} strike(s).`);
  }

  return state;
}

export function runSimulation(config: LevelConfig, dt = 0.1): SimulationState {
  const state = createInitialState(config);

  while (state.status === "running") {
    tick(state, dt);
  }

  return state;
}

export function assignPassengerToLavatory(
  state: SimulationState,
  passengerId: string,
  lavatoryId: string
): SimulationState {
  if (state.status !== "running") {
    throw new Error("cannot assign passengers after simulation has ended");
  }

  const passenger = findPassenger(state, passengerId);
  const lavatory = findLavatory(state, lavatoryId);

  if (isSeatBeltSignOn(state)) {
    throw new Error("cannot assign passengers while the seat belt sign is on");
  }

  if (
    passenger.state === "UsingLavatory" ||
    passenger.state === "ReturningToSeat" ||
    passenger.state === "Sitting"
  ) {
    throw new Error(`${passenger.id} cannot be reassigned while ${passenger.state}`);
  }

  stopBlockingForAssignment(state, passenger);
  const previousLavatoryId = passenger.assignedLavatoryId;
  if (previousLavatoryId !== undefined) {
    removeFromLavatoryQueue(state, passenger.id);
  }

  passenger.assignedLavatoryId = lavatory.id;
  passenger.lavatorySecondsRemaining = 0;
  startSeatExit(state, passenger, lavatory.row);

  if (previousLavatoryId !== undefined && previousLavatoryId !== lavatory.id) {
    addEvent(
      state,
      "lavatoryRerouted",
      `${passenger.id} rerouted from ${previousLavatoryId} to ${lavatory.id}.`,
      passenger.id,
      lavatory.id
    );
  } else {
    addEvent(
      state,
      "lavatoryAssigned",
      `${passenger.id} assigned to ${lavatory.id} lavatory.`,
      passenger.id,
      lavatory.id
    );
  }

  return state;
}

export function startBeverageCart(state: SimulationState): SimulationState {
  if (state.status !== "running") {
    throw new Error("cannot start beverage cart after simulation has ended");
  }

  const cart = state.beverageCart;
  if (cart === undefined) {
    throw new Error("level does not configure a beverage cart");
  }

  if (cart.state !== "ready") {
    if (cart.state === "complete") {
      resetBeverageCart(cart, requireBeverageCartConfig(state));
    } else {
      return state;
    }
  }

  if (
    requireBeverageCartConfig(state).serviceRows.some(
      (row) => row < 1 || row > state.config.aircraft.rows
    )
  ) {
    throw new Error("beverageCart.serviceRows must be aircraft row numbers");
  }

  addEvent(
    state,
    "beverageCartStarted",
    `${cart.id} beverage cart started service at row ${cart.currentAisleRow}.`
  );
  startBeverageRowService(state, cart);
  refreshAisleCells(state);
  return state;
}

export function startTurbulence(state: SimulationState): SimulationState {
  if (state.status !== "running") {
    throw new Error("cannot start turbulence after simulation has ended");
  }

  const turbulence = state.turbulence;
  if (turbulence === undefined) {
    throw new Error("level does not configure turbulence");
  }

  if (turbulence.phase !== "idle") {
    return state;
  }

  turbulence.hasAutoStarted = true;
  turbulence.willTurnSeatBeltSignOn = shouldTurnSeatBeltSignOn(state);
  turbulence.warningSecondsRemaining = requireTurbulenceConfig(state).warningSeconds;
  turbulence.activeSecondsRemaining = 0;

  if (turbulence.warningSecondsRemaining > 0) {
    turbulence.phase = "warning";
    addEvent(
      state,
      "turbulenceWarning",
      `Turbulence warning: seat belt sign possible in ${turbulence.warningSecondsRemaining}s.`
    );
  } else {
    finishTurbulenceWarning(state, turbulence);
  }

  return state;
}

export function summarize(state: SimulationState, urgentLimit = 5): SimulationSummary {
  const urgency = state.passengers
    .map(toUrgency)
    .sort((left, right) => {
      if (right.bladderPercent !== left.bladderPercent) {
        return right.bladderPercent - left.bladderPercent;
      }
      return left.id.localeCompare(right.id);
    });

  const averageBladderPercent =
    urgency.reduce((total, passenger) => total + passenger.bladderPercent, 0) /
    Math.max(urgency.length, 1);

  return {
    time: state.time,
    status: state.status,
    strikes: state.strikes,
    panicCount: state.passengers.filter((passenger) => passenger.state === "Panic").length,
    needsToGoCount: state.passengers.filter((passenger) => passenger.state === "NeedsToGo").length,
    averageBladderPercent,
    aisleCells: state.aisleCells.map((cell) => ({
      row: cell.row,
      passengerIds: [...cell.passengerIds],
      beverageCartId: cell.beverageCartId
    })),
    lavatories: state.lavatories.map((lavatory) => ({
      id: lavatory.id,
      row: lavatory.row,
      occupantPassengerId: lavatory.occupantPassengerId,
      queue: [...lavatory.queue]
    })),
    beverageCart: state.beverageCart
      ? {
          ...state.beverageCart,
          passengerIdsServed: [...state.beverageCart.passengerIdsServed]
        }
      : undefined,
    turbulence: state.turbulence ? { ...state.turbulence } : undefined,
    mostUrgent: urgency.slice(0, urgentLimit)
  };
}

function resetBeverageCart(cart: BeverageCart, cartConfig: NonNullable<LevelConfig["beverageCart"]>): void {
  cart.state = "ready";
  cart.currentAisleRow = cartConfig.serviceRows[0] ?? 1;
  cart.destinationAisleRow = undefined;
  cart.serviceRowIndex = 0;
  cart.serviceSecondsRemaining = 0;
  cart.movementStepSecondsRemaining = 0;
  cart.passengerIdsServed = [];
}

export function bladderPercent(passenger: Passenger): number {
  return Math.min(passenger.rawBladder / passenger.capacity, 1);
}

function updateLavatoryProgress(state: SimulationState, dt: number): void {
  updateTurbulenceProgress(state, dt);
  updateBeverageCartProgress(state, dt);
  updateBabyDiaperProgress(state, dt);
  updateSeatBlockerProgress(state, dt);

  for (const passenger of state.passengers) {
    if (passenger.state === "ReturningToSeat") {
      advanceAisleMovement(state, passenger, dt);
    }
  }

  for (const lavatory of state.lavatories) {
    const occupant = lavatory.occupantPassengerId
      ? state.passengers.find((passenger) => passenger.id === lavatory.occupantPassengerId)
      : undefined;

    if (occupant !== undefined) {
      occupant.lavatorySecondsRemaining = Math.max(0, occupant.lavatorySecondsRemaining - dt);
      if (occupant.lavatorySecondsRemaining === 0) {
        finishLavatoryUse(state, lavatory, occupant);
      }
    }

    startNextQueuedPassenger(state, lavatory);
  }

  for (const passenger of state.passengers) {
    if (passenger.state === "WalkingToLavatory") {
      advanceAisleMovement(state, passenger, dt);
    }
  }

  refreshAisleCells(state);
}

function updateSeatBlockerProgress(state: SimulationState, dt: number): void {
  for (const passenger of state.passengers) {
    passenger.standCooldownSecondsRemaining = Math.max(
      0,
      passenger.standCooldownSecondsRemaining - dt
    );

    if (passenger.state === "Standing") {
      passenger.standSecondsRemaining = Math.max(0, passenger.standSecondsRemaining - dt);
    }

    if (passenger.state === "Sitting") {
      passenger.sitSecondsRemaining = Math.max(0, passenger.sitSecondsRemaining - dt);
      if (passenger.sitSecondsRemaining === 0) {
        finishSitting(state, passenger);
      }
    }
  }

  for (const passenger of state.passengers) {
    if (passenger.state === "WaitingForSeatBlockers") {
      startSeatExit(state, passenger, requireAssignedLavatoryRow(state, passenger), false);
    }

    if (
      passenger.state === "Standing" &&
      passenger.blockingPassengerId === undefined &&
      passenger.assignedLavatoryId !== undefined &&
      passenger.standSecondsRemaining === 0 &&
      seatExitBlockers(state, passenger).every(
        (blocker) =>
          blocker.blockingPassengerId === passenger.id && blocker.standSecondsRemaining === 0
      )
    ) {
      passenger.state = "WalkingToLavatory";
      startAisleMovement(state, passenger, requireAssignedLavatoryRow(state, passenger), passenger.row);
    }
  }

  for (const blocker of state.passengers) {
    if (
      blocker.state !== "Standing" ||
      blocker.blockingPassengerId === undefined ||
      blocker.standSecondsRemaining > 0
    ) {
      continue;
    }

    const blockedPassenger = state.passengers.find(
      (passenger) => passenger.id === blocker.blockingPassengerId
    );
    if (
      blockedPassenger === undefined ||
      blockedPassenger.state === "Panic" ||
      blockedPassenger.aisleRow !== blocker.row ||
      blockedPassenger.destinationAisleRow === undefined
    ) {
      startSitting(state, blocker);
    }
  }

  refreshAisleCells(state);
}

function startSeatExit(
  state: SimulationState,
  passenger: Passenger,
  lavatoryRow: number,
  logBlocked = true
): void {
  if (isSeatBeltSignOn(state)) {
    passenger.state =
      bladderPercent(passenger) >= state.config.bladder.requestThreshold ? "NeedsToGo" : "Seated";
    passenger.assignedLavatoryId = undefined;
    passenger.aisleRow = undefined;
    passenger.destinationAisleRow = undefined;
    passenger.queuePosition = undefined;
    passenger.movementSecondsRemaining = 0;
    passenger.movementStepSecondsRemaining = 0;
    passenger.standSecondsRemaining = 0;
    refreshAisleCells(state);
    return;
  }

  releaseSeatBlockers(state, passenger.id);

  const blockers = seatExitBlockers(state, passenger);
  const unavailableBlockers = blockers.filter((blocker) => !canStandAsBlocker(blocker));
  if (unavailableBlockers.length > 0) {
    passenger.state = "WaitingForSeatBlockers";
    passenger.aisleRow = undefined;
    passenger.destinationAisleRow = lavatoryRow;
    passenger.movementSecondsRemaining = 0;
    passenger.movementStepSecondsRemaining = 0;
    passenger.standSecondsRemaining = 0;
    if (logBlocked) {
      addEvent(
        state,
        "seatBlocked",
        `${passenger.id} is waiting for ${unavailableBlockers
          .map((blocker) => blocker.id)
          .join(", ")} to stand.`,
        passenger.id
      );
    }
    refreshAisleCells(state);
    return;
  }

  for (const blocker of blockers) {
    blocker.state = "Standing";
    blocker.blockingPassengerId = passenger.id;
    blocker.aisleRow = blocker.row;
    blocker.destinationAisleRow = undefined;
    blocker.queuePosition = undefined;
    blocker.movementSecondsRemaining = 0;
    blocker.movementStepSecondsRemaining = 0;
    blocker.standSecondsRemaining = state.config.seatBlockers.standSeconds;
    blocker.sitSecondsRemaining = 0;
    addEvent(
      state,
      "seatBlockerStood",
      `${blocker.id} stood to let ${passenger.id} out.`,
      blocker.id
    );
  }

  passenger.state = "Standing";
  passenger.aisleRow = passenger.row;
  passenger.destinationAisleRow = lavatoryRow;
  passenger.queuePosition = undefined;
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.standSecondsRemaining = state.config.seatBlockers.standSeconds;
  passenger.sitSecondsRemaining = 0;
  refreshAisleCells(state);

  if (
    passenger.standSecondsRemaining === 0 &&
    blockers.every((blocker) => blocker.standSecondsRemaining === 0)
  ) {
    passenger.state = "WalkingToLavatory";
    startAisleMovement(state, passenger, lavatoryRow, passenger.row);
  }
}

function startSitting(state: SimulationState, passenger: Passenger): void {
  passenger.state = "Sitting";
  passenger.aisleRow = passenger.row;
  passenger.destinationAisleRow = undefined;
  passenger.queuePosition = undefined;
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.standSecondsRemaining = 0;
  passenger.sitSecondsRemaining = state.config.seatBlockers.sitSeconds;

  if (passenger.sitSecondsRemaining === 0) {
    finishSitting(state, passenger);
  }
}

function finishSitting(state: SimulationState, passenger: Passenger): void {
  const wasBlocker = passenger.blockingPassengerId !== undefined;
  const blockedPassengerId = passenger.blockingPassengerId;
  passenger.blockingPassengerId = undefined;
  passenger.aisleRow = undefined;
  passenger.destinationAisleRow = undefined;
  passenger.sitSecondsRemaining = 0;
  passenger.standCooldownSecondsRemaining = state.config.seatBlockers.standCooldownSeconds;
  passenger.state =
    bladderPercent(passenger) >= state.config.bladder.requestThreshold ? "NeedsToGo" : "Seated";

  if (wasBlocker) {
    addEvent(
      state,
      "seatBlockerSat",
      `${passenger.id} sat after letting ${blockedPassengerId} out.`,
      passenger.id
    );
  }
}

function seatExitBlockers(state: SimulationState, passenger: Passenger): Passenger[] {
  const seatIndex = state.config.aircraft.seatLayout.indexOf(passenger.seat);
  if (seatIndex === -1) {
    return [];
  }

  const aisleSplit = Math.ceil(state.config.aircraft.seatLayout.length / 2);
  const blockingSeatIndexes =
    seatIndex < aisleSplit
      ? rangeIndexes(seatIndex + 1, aisleSplit)
      : rangeIndexes(aisleSplit, seatIndex);
  const blockingSeats = blockingSeatIndexes.map((index) => state.config.aircraft.seatLayout[index]);

  return state.passengers.filter(
    (candidate) =>
      candidate.row === passenger.row &&
      blockingSeats.includes(candidate.seat) &&
      isSeatBlockingOccupant(candidate, passenger.id)
  );
}

function rangeIndexes(startInclusive: number, endExclusive: number): number[] {
  const indexes: number[] = [];
  for (let index = startInclusive; index < endExclusive; index += 1) {
    indexes.push(index);
  }
  return indexes;
}

function isSeatBlockingOccupant(passenger: Passenger, blockedPassengerId: string): boolean {
  if (passenger.blockingPassengerId === blockedPassengerId) {
    return true;
  }
  return (
    passenger.state === "Seated" ||
    passenger.state === "NeedsToGo" ||
    passenger.state === "Panic" ||
    passenger.state === "Sitting"
  );
}

function canStandAsBlocker(passenger: Passenger): boolean {
  return (
    (passenger.state === "Seated" ||
      passenger.state === "NeedsToGo" ||
      passenger.state === "Panic") &&
    passenger.standCooldownSecondsRemaining === 0 &&
    passenger.assignedLavatoryId === undefined
  );
}

function releaseSeatBlockers(state: SimulationState, blockedPassengerId: string): void {
  for (const blocker of state.passengers) {
    if (blocker.blockingPassengerId === blockedPassengerId) {
      startSitting(state, blocker);
    }
  }
}

function stopBlockingForAssignment(state: SimulationState, passenger: Passenger): void {
  const blockedPassengerId = passenger.blockingPassengerId;
  if (blockedPassengerId === undefined) {
    return;
  }

  passenger.blockingPassengerId = undefined;
  const blockedPassenger = state.passengers.find((candidate) => candidate.id === blockedPassengerId);
  if (
    blockedPassenger !== undefined &&
    (blockedPassenger.state === "Standing" ||
      blockedPassenger.state === "WaitingForSeatBlockers")
  ) {
    blockedPassenger.state = "WaitingForSeatBlockers";
    blockedPassenger.aisleRow = undefined;
    blockedPassenger.standSecondsRemaining = 0;
  }
}

function requireAssignedLavatoryRow(state: SimulationState, passenger: Passenger): number {
  return findLavatory(state, requireAssignedLavatory(passenger)).row;
}

function arriveAtLavatory(state: SimulationState, passenger: Passenger): void {
  const lavatory = findLavatory(state, requireAssignedLavatory(passenger));
  if (lavatory.occupantPassengerId === undefined && lavatory.queue.length === 0) {
    startUsingLavatory(state, lavatory, passenger);
    return;
  }

  passenger.state = "QueuedForLavatory";
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  if (!lavatory.queue.includes(passenger.id)) {
    lavatory.queue.push(passenger.id);
  }
  updateLavatoryQueuePositions(state, lavatory);
  addEvent(
    state,
    "lavatoryQueued",
    `${passenger.id} queued for ${lavatory.id} lavatory.`,
    passenger.id,
    lavatory.id
  );
}

function startNextQueuedPassenger(state: SimulationState, lavatory: Lavatory): void {
  if (lavatory.occupantPassengerId !== undefined) {
    return;
  }

  const nextPassengerId = lavatory.queue.shift();
  if (nextPassengerId === undefined) {
    return;
  }

  updateLavatoryQueuePositions(state, lavatory);
  startUsingLavatory(state, lavatory, findPassenger(state, nextPassengerId));
}

function startUsingLavatory(state: SimulationState, lavatory: Lavatory, passenger: Passenger): void {
  lavatory.occupantPassengerId = passenger.id;
  passenger.state = "UsingLavatory";
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.destinationAisleRow = undefined;
  passenger.aisleRow = lavatory.row;
  passenger.queuePosition = undefined;
  passenger.panicSeconds = 0;
  passenger.lavatorySecondsRemaining = lavatoryUseSeconds(state, passenger);
  passenger.lavatoryVisitCount += 1;
  addEvent(
    state,
    "lavatoryEntered",
    `${passenger.id} entered ${lavatory.id} lavatory.`,
    passenger.id,
    lavatory.id
  );
}

function finishLavatoryUse(state: SimulationState, lavatory: Lavatory, passenger: Passenger): void {
  lavatory.occupantPassengerId = undefined;
  passenger.rawBladder = 0;
  passenger.panicSeconds = 0;
  passenger.lavatorySecondsRemaining = 0;
  if (passenger.babyDiaperNeedsChange) {
    passenger.babyDiaperNeedsChange = false;
    passenger.babyDiaperChangeCount += 1;
    passenger.babyDiaperSecondsRemaining = babyDiaperEventSeconds(
      state.config,
      `repeat:${passenger.id}:${passenger.babyDiaperChangeCount}`
    );
    addEvent(
      state,
      "babyDiaperChanged",
      `${passenger.id}'s baby diaper was changed in ${lavatory.id} lavatory.`,
      passenger.id,
      lavatory.id
    );
  }
  passenger.state = "ReturningToSeat";
  startAisleMovement(state, passenger, passenger.row, lavatory.row);
  addEvent(
    state,
    "lavatoryComplete",
    `${passenger.id} finished using ${lavatory.id} lavatory.`,
    passenger.id,
    lavatory.id
  );
}

function updatePassengerBladder(state: SimulationState, passenger: Passenger, dt: number): boolean {
  updateBeverageModifier(state, passenger);
  passenger.rawBladder +=
    state.config.bladder.baseFillPerSecond *
    passenger.bladderRateMultiplier *
    passenger.beverageRateMultiplier *
    dt;

  const percent = bladderPercent(passenger);
  const previousState = passenger.state;
  const nextState = nextPassengerState(state, passenger, percent);

  if (previousState !== nextState) {
    passenger.state = nextState;
    if (nextState === "NeedsToGo") {
      addEvent(
        state,
        "request",
        `${passenger.id} at ${passenger.row}${passenger.seat} needs to go.`,
        passenger.id
      );
    }
    if (nextState === "Panic") {
      abandonLavatoryAssignment(state, passenger);
      passenger.panicSeconds = 0;
      addEvent(
        state,
        "panic",
        `${passenger.id} at ${passenger.row}${passenger.seat} is in panic.`,
        passenger.id
      );
    }
  }

  if (passenger.state === "Panic") {
    passenger.panicSeconds += dt;
  }

  if (
    passenger.state === "Panic" &&
    passenger.panicSeconds >= state.config.loss.panicGraceSeconds
  ) {
    state.strikes += 1;
    passenger.strikeCount += 1;
    passenger.rawBladder = passenger.capacity * state.config.loss.strikeRecoveryFillPercent;
    passenger.panicSeconds = 0;
    passenger.state =
      passenger.babyDiaperNeedsChange ||
      state.config.loss.strikeRecoveryFillPercent >= state.config.bladder.requestThreshold
        ? "NeedsToGo"
        : "Seated";

    addEvent(
      state,
      "strike",
      `${passenger.id} caused strike ${state.strikes}/${state.config.loss.maxStrikes}.`,
      passenger.id
    );

    if (state.strikes >= state.config.loss.maxStrikes) {
      state.status = "lost";
      addEvent(state, "loss", `Flight failed after ${state.strikes} strike(s).`);
      return true;
    }
  }

  return false;
}

function nextPassengerState(
  state: SimulationState,
  passenger: Passenger,
  percent: number
): PassengerState {
  if (percent >= 1) {
    return "Panic";
  }
  if (passenger.babyDiaperNeedsChange && passenger.state === "Seated") {
    return "NeedsToGo";
  }
  if (
    passenger.state === "WalkingToLavatory" ||
    passenger.state === "WaitingForSeatBlockers" ||
    passenger.state === "Standing" ||
    passenger.state === "QueuedForLavatory" ||
    passenger.state === "ReturningToSeat" ||
    passenger.state === "Sitting"
  ) {
    return passenger.state;
  }
  if (passenger.state === "Panic") {
    return "Panic";
  }
  if (passenger.babyDiaperNeedsChange) {
    return "NeedsToGo";
  }
  if (percent >= state.config.bladder.requestThreshold) {
    return "NeedsToGo";
  }
  return "Seated";
}

function startAisleMovement(
  state: SimulationState,
  passenger: Passenger,
  destinationAisleRow: number,
  startingAisleRow = passenger.row
): void {
  passenger.aisleRow = startingAisleRow;
  passenger.destinationAisleRow = destinationAisleRow;
  passenger.queuePosition = undefined;
  passenger.movementStepSecondsRemaining = state.config.lavatory.minimumWalkSeconds;
  passenger.movementSecondsRemaining = estimateAisleMovementSeconds(
    state,
    startingAisleRow,
    destinationAisleRow
  );

  if (isBeverageCartBlockingAisleStep(state, passenger)) {
    passenger.movementStepSecondsRemaining = 0;
  } else if (passenger.movementStepSecondsRemaining === 0) {
    passenger.movementStepSecondsRemaining = nextAisleStepSeconds(state, passenger);
  }
  refreshAisleCells(state);
}

function advanceAisleMovement(state: SimulationState, passenger: Passenger, dt: number): void {
  let remainingDt = dt;

  while (remainingDt > 0 && passenger.destinationAisleRow !== undefined) {
    if (passenger.movementStepSecondsRemaining === 0) {
      if (passenger.aisleRow === passenger.destinationAisleRow) {
        completeAisleMovement(state, passenger);
        break;
      }
      if (isBeverageCartBlockingAisleStep(state, passenger)) {
        break;
      }
      passenger.movementStepSecondsRemaining = nextAisleStepSeconds(state, passenger);
    }

    if (passenger.movementStepSecondsRemaining === 0) {
      passenger.aisleRow = nextAisleRow(passenger);
      refreshAisleCells(state);
      continue;
    }

    if (isBeverageCartBlockingAisleStep(state, passenger)) {
      break;
    }

    const elapsed = Math.min(remainingDt, passenger.movementStepSecondsRemaining);
    passenger.movementStepSecondsRemaining = Math.max(0, passenger.movementStepSecondsRemaining - elapsed);
    passenger.movementSecondsRemaining = Math.max(0, passenger.movementSecondsRemaining - elapsed);
    remainingDt -= elapsed;

    if (passenger.movementStepSecondsRemaining > 0) {
      break;
    }

    if (passenger.aisleRow === passenger.destinationAisleRow) {
      completeAisleMovement(state, passenger);
      break;
    }

    passenger.aisleRow = nextAisleRow(passenger);
    refreshAisleCells(state);

    if (passenger.aisleRow === passenger.destinationAisleRow) {
      completeAisleMovement(state, passenger);
      break;
    }
  }
}

function completeAisleMovement(state: SimulationState, passenger: Passenger): void {
  passenger.destinationAisleRow = undefined;
  passenger.movementStepSecondsRemaining = 0;
  passenger.movementSecondsRemaining = 0;

  if (passenger.state === "WalkingToLavatory") {
    arriveAtLavatory(state, passenger);
    return;
  }

  if (passenger.state === "ReturningToSeat") {
    passenger.assignedLavatoryId = undefined;
    startSitting(state, passenger);
    addEvent(
      state,
      "returned",
      `${passenger.id} returned to ${passenger.row}${passenger.seat}.`,
      passenger.id
    );
  }
}

function nextAisleStepSeconds(state: SimulationState, passenger: Passenger): number {
  if (passenger.aisleRow === passenger.destinationAisleRow) {
    return 0;
  }

  const nextRow = nextAisleRow(passenger);
  const baseSeconds = state.config.lavatory.walkSecondsPerRow;
  if (isBeverageCartBlockingAisleStep(state, passenger)) {
    return 0;
  }
  const hasPassingConflict = state.passengers.some(
    (candidate) =>
      candidate.id !== passenger.id &&
      isInAisle(candidate) &&
      (candidate.aisleRow === passenger.aisleRow || candidate.aisleRow === nextRow)
  );
  return hasPassingConflict
    ? baseSeconds * (state.config.lavatory.passingSlowdownMultiplier ?? 2)
    : baseSeconds;
}

function isBeverageCartBlockingAisleStep(state: SimulationState, passenger: Passenger): boolean {
  if (passenger.aisleRow === undefined || passenger.destinationAisleRow === undefined) {
    return false;
  }

  const cart = state.beverageCart;
  if (cart === undefined || (cart.state !== "moving" && cart.state !== "servicing")) {
    return false;
  }

  const nextRow = nextAisleRow(passenger);
  return cart.currentAisleRow === passenger.aisleRow || cart.currentAisleRow === nextRow;
}

function nextAisleRow(passenger: Passenger): number {
  if (passenger.aisleRow === undefined || passenger.destinationAisleRow === undefined) {
    throw new Error(`${passenger.id} is missing aisle movement data`);
  }
  return passenger.aisleRow + Math.sign(passenger.destinationAisleRow - passenger.aisleRow);
}

function isInAisle(passenger: Passenger): boolean {
  return (
    passenger.aisleRow !== undefined &&
    (passenger.state === "Standing" ||
      passenger.state === "WalkingToLavatory" ||
      passenger.state === "QueuedForLavatory" ||
      passenger.state === "ReturningToSeat" ||
      passenger.state === "Sitting")
  );
}

function estimateAisleMovementSeconds(
  state: SimulationState,
  startingAisleRow: number,
  destinationAisleRow: number
): number {
  return (
    state.config.lavatory.minimumWalkSeconds +
    Math.abs(startingAisleRow - destinationAisleRow) * state.config.lavatory.walkSecondsPerRow
  );
}

function buildAisleCells(config: LevelConfig, passengers: Passenger[]): AisleCell[] {
  const lavatoryRows = config.aircraft.lavatories.map((lavatory) => lavatory.row);
  const minRow = Math.min(1, ...lavatoryRows);
  const maxRow = Math.max(config.aircraft.rows, ...lavatoryRows);

  const cells: AisleCell[] = [];
  const cellsByRow = new Map<number, AisleCell>();
  for (let row = minRow; row <= maxRow; row += 1) {
    const cell: AisleCell = { row, passengerIds: [], beverageCartId: undefined };
    cells.push(cell);
    cellsByRow.set(row, cell);
  }

  for (const passenger of passengers) {
    if (passenger.aisleRow === undefined || !isInAisle(passenger)) {
      continue;
    }
    const cell = cellsByRow.get(passenger.aisleRow);
    if (cell !== undefined) {
      cell.passengerIds.push(passenger.id);
    }
  }

  return cells;
}

function refreshAisleCells(state: SimulationState): void {
  state.aisleCells = buildAisleCells(state.config, state.passengers);
  if (
    state.beverageCart !== undefined &&
    (state.beverageCart.state === "moving" || state.beverageCart.state === "servicing")
  ) {
    const cartCell = state.aisleCells.find(
      (cell) => cell.row === state.beverageCart?.currentAisleRow
    );
    if (cartCell !== undefined) {
      cartCell.beverageCartId = state.beverageCart.id;
    }
  }
}

function buildBeverageCart(config: LevelConfig): BeverageCart | undefined {
  const cartConfig = config.beverageCart;
  if (cartConfig === undefined) {
    return undefined;
  }

  return {
    id: "beverage-cart",
    state: "ready",
    currentAisleRow: cartConfig.serviceRows[0] ?? 1,
    serviceRowIndex: 0,
    serviceSecondsRemaining: 0,
    movementStepSecondsRemaining: 0,
    passengerIdsServed: []
  };
}

function buildTurbulence(config: LevelConfig): Turbulence | undefined {
  if (config.turbulence === undefined) {
    return undefined;
  }

  return {
    phase: "idle",
    warningSecondsRemaining: 0,
    activeSecondsRemaining: 0,
    hasAutoStarted: false
  };
}

function updateBabyDiaperProgress(state: SimulationState, dt: number): void {
  if (state.config.babyDiaper === undefined) {
    return;
  }

  for (const passenger of state.passengers) {
    if (
      passenger.archetype !== "babyAttachedAdult" ||
      passenger.babyDiaperNeedsChange ||
      passenger.babyDiaperSecondsRemaining === undefined
    ) {
      continue;
    }

    passenger.babyDiaperSecondsRemaining = Math.max(0, passenger.babyDiaperSecondsRemaining - dt);
    if (passenger.babyDiaperSecondsRemaining > 0) {
      continue;
    }

    passenger.babyDiaperNeedsChange = true;
    passenger.babyDiaperSecondsRemaining = undefined;
    if (passenger.state === "Seated") {
      passenger.state = "NeedsToGo";
    }
    addEvent(
      state,
      "babyDiaperNeeded",
      `${passenger.id}'s baby needs a diaper change.`,
      passenger.id
    );
  }
}

function updateTurbulenceProgress(state: SimulationState, dt: number): void {
  const turbulence = state.turbulence;
  const turbulenceConfig = state.config.turbulence;
  if (turbulence === undefined || turbulenceConfig === undefined) {
    return;
  }

  if (
    turbulence.phase === "idle" &&
    turbulenceConfig.autoStartSeconds !== undefined &&
    !turbulence.hasAutoStarted &&
    state.time >= turbulenceConfig.autoStartSeconds
  ) {
    startTurbulence(state);
  }

  if (turbulence.phase === "warning") {
    turbulence.warningSecondsRemaining = Math.max(0, turbulence.warningSecondsRemaining - dt);
    if (turbulence.warningSecondsRemaining === 0) {
      finishTurbulenceWarning(state, turbulence);
    }
    return;
  }

  if (turbulence.phase === "active") {
    turbulence.activeSecondsRemaining = Math.max(0, turbulence.activeSecondsRemaining - dt);
    if (turbulence.activeSecondsRemaining === 0) {
      turbulence.phase = "idle";
      turbulence.willTurnSeatBeltSignOn = undefined;
      addEvent(state, "seatBeltSignOff", "Seat belt sign turned off.");
    }
  }
}

function finishTurbulenceWarning(state: SimulationState, turbulence: Turbulence): void {
  if (turbulence.willTurnSeatBeltSignOn !== true) {
    turbulence.phase = "idle";
    turbulence.warningSecondsRemaining = 0;
    turbulence.activeSecondsRemaining = 0;
    turbulence.willTurnSeatBeltSignOn = undefined;
    addEvent(state, "seatBeltSignSkipped", "Turbulence passed without the seat belt sign.");
    return;
  }

  turbulence.phase = "active";
  turbulence.warningSecondsRemaining = 0;
  turbulence.activeSecondsRemaining = turbulenceDurationSeconds(state);
  addEvent(
    state,
    "seatBeltSignOn",
    `Seat belt sign turned on for ${turbulence.activeSecondsRemaining.toFixed(1)}s.`
  );
  forceAislePassengersToReturn(state);
}

function forceAislePassengersToReturn(state: SimulationState): void {
  for (const passenger of state.passengers) {
    if (passenger.state === "UsingLavatory" || passenger.state === "ReturningToSeat") {
      continue;
    }

    if (
      passenger.state === "WalkingToLavatory" ||
      passenger.state === "QueuedForLavatory" ||
      passenger.state === "Standing" ||
      passenger.state === "WaitingForSeatBlockers"
    ) {
      const returnStartRow = passenger.aisleRow;
      abandonLavatoryAssignment(state, passenger);
      if (returnStartRow !== undefined && returnStartRow !== passenger.row) {
        passenger.state = "ReturningToSeat";
        startAisleMovement(state, passenger, passenger.row, returnStartRow);
      } else if (returnStartRow !== undefined) {
        passenger.aisleRow = returnStartRow;
        startSitting(state, passenger);
      } else {
        passenger.state =
          bladderPercent(passenger) >= state.config.bladder.requestThreshold ? "NeedsToGo" : "Seated";
      }
      addEvent(state, "forcedReturn", `${passenger.id} returned because the seat belt sign is on.`, passenger.id);
    }
  }

  refreshAisleCells(state);
}

function isSeatBeltSignOn(state: SimulationState): boolean {
  return state.turbulence?.phase === "active";
}

function shouldTurnSeatBeltSignOn(state: SimulationState): boolean {
  const chance = requireTurbulenceConfig(state).seatBeltSignChance;
  if (chance <= 0) {
    return false;
  }
  if (chance >= 1) {
    return true;
  }

  const hash = hashString(`${state.config.seed}:turbulence:${state.time}:sign`);
  return hash < chance;
}

function turbulenceDurationSeconds(state: SimulationState): number {
  const [min, max] = requireTurbulenceConfig(state).durationSeconds;
  if (min === max) {
    return min;
  }

  const hash = hashString(`${state.config.seed}:turbulence:${state.time}:duration`);
  return min + (max - min) * hash;
}

function requireTurbulenceConfig(state: SimulationState) {
  const turbulenceConfig = state.config.turbulence;
  if (turbulenceConfig === undefined) {
    throw new Error("level does not configure turbulence");
  }
  return turbulenceConfig;
}

function updateBeverageCartProgress(state: SimulationState, dt: number): void {
  const cart = state.beverageCart;
  if (cart === undefined) {
    return;
  }

  if (cart.state === "servicing") {
    cart.serviceSecondsRemaining = Math.max(0, cart.serviceSecondsRemaining - dt);
    if (cart.serviceSecondsRemaining === 0) {
      finishBeverageRowService(state, cart);
    }
    refreshAisleCells(state);
    return;
  }

  if (cart.state !== "moving") {
    return;
  }

  let remainingDt = dt;
  while (remainingDt > 0 && cart.destinationAisleRow !== undefined) {
    if (cart.currentAisleRow === cart.destinationAisleRow) {
      startBeverageRowService(state, cart);
      break;
    }

    if (cart.movementStepSecondsRemaining === 0) {
      cart.movementStepSecondsRemaining = state.config.beverageCart?.moveSecondsPerRow ?? 0;
    }

    if (cart.movementStepSecondsRemaining === 0) {
      cart.currentAisleRow = nextCartAisleRow(cart);
      refreshAisleCells(state);
      continue;
    }

    const elapsed = Math.min(remainingDt, cart.movementStepSecondsRemaining);
    cart.movementStepSecondsRemaining = Math.max(0, cart.movementStepSecondsRemaining - elapsed);
    remainingDt -= elapsed;

    if (cart.movementStepSecondsRemaining > 0) {
      break;
    }

    cart.currentAisleRow = nextCartAisleRow(cart);
    refreshAisleCells(state);
    if (cart.currentAisleRow === cart.destinationAisleRow) {
      startBeverageRowService(state, cart);
      break;
    }
  }
}

function startBeverageRowService(state: SimulationState, cart: BeverageCart): void {
  const cartConfig = requireBeverageCartConfig(state);
  cart.state = "servicing";
  cart.destinationAisleRow = undefined;
  cart.movementStepSecondsRemaining = 0;
  cart.currentAisleRow = cartConfig.serviceRows[cart.serviceRowIndex] ?? cart.currentAisleRow;
  cart.serviceSecondsRemaining = beverageRowServiceSeconds(state, cart.serviceRowIndex);
  addEvent(
    state,
    "beverageCartArrived",
    `${cart.id} arrived to service row ${cart.currentAisleRow}.`
  );
}

function finishBeverageRowService(state: SimulationState, cart: BeverageCart): void {
  const cartConfig = requireBeverageCartConfig(state);
  const passengersInRow = state.passengers.filter((passenger) => passenger.row === cart.currentAisleRow);

  for (const passenger of passengersInRow) {
    passenger.beverageRateModifierStartSeconds = state.time + cartConfig.bladderRateDelaySeconds;
    passenger.beverageRateModifierEndSeconds =
      passenger.beverageRateModifierStartSeconds + cartConfig.bladderRateDurationSeconds;
    cart.passengerIdsServed.push(passenger.id);
  }

  addEvent(
    state,
    "beverageCartServiced",
    `${cart.id} serviced row ${cart.currentAisleRow} (${passengersInRow.length} passenger(s)).`
  );

  cart.serviceRowIndex += 1;
  const nextServiceRow = cartConfig.serviceRows[cart.serviceRowIndex];
  if (nextServiceRow === undefined) {
    cart.state = "complete";
    cart.destinationAisleRow = undefined;
    cart.serviceSecondsRemaining = 0;
    cart.movementStepSecondsRemaining = 0;
    addEvent(state, "beverageCartComplete", `${cart.id} completed service.`);
    refreshAisleCells(state);
    return;
  }

  cart.state = "moving";
  cart.destinationAisleRow = nextServiceRow;
  cart.serviceSecondsRemaining = 0;
  cart.movementStepSecondsRemaining = state.config.beverageCart?.moveSecondsPerRow ?? 0;
  addEvent(
    state,
    "beverageCartDeparted",
    `${cart.id} departed row ${cart.currentAisleRow} for row ${nextServiceRow}.`
  );
  refreshAisleCells(state);
}

function updateBeverageModifier(state: SimulationState, passenger: Passenger): void {
  const cartConfig = state.config.beverageCart;
  if (
    cartConfig === undefined ||
    passenger.beverageRateModifierStartSeconds === undefined ||
    passenger.beverageRateModifierEndSeconds === undefined
  ) {
    passenger.beverageRateMultiplier = 1;
    return;
  }

  passenger.beverageRateMultiplier =
    state.time >= passenger.beverageRateModifierStartSeconds &&
    state.time < passenger.beverageRateModifierEndSeconds
      ? cartConfig.bladderRateMultiplier
      : 1;
}

function nextCartAisleRow(cart: BeverageCart): number {
  if (cart.destinationAisleRow === undefined) {
    throw new Error(`${cart.id} is missing a destination row`);
  }
  return cart.currentAisleRow + Math.sign(cart.destinationAisleRow - cart.currentAisleRow);
}

function beverageRowServiceSeconds(state: SimulationState, serviceRowIndex: number): number {
  const [min, max] = requireBeverageCartConfig(state).rowServiceSeconds;
  if (min === max) {
    return min;
  }

  const hash = hashString(`${state.config.seed}:beverage-cart:${serviceRowIndex}`);
  return min + (max - min) * hash;
}

function requireBeverageCartConfig(state: SimulationState) {
  const cartConfig = state.config.beverageCart;
  if (cartConfig === undefined) {
    throw new Error("level does not configure a beverage cart");
  }
  return cartConfig;
}

function updateLavatoryQueuePositions(state: SimulationState, lavatory: Lavatory): void {
  lavatory.queue.forEach((passengerId, index) => {
    const passenger = findPassenger(state, passengerId);
    passenger.queuePosition = index + 1;
    passenger.aisleRow = queueAisleRow(state, lavatory, passenger.queuePosition);
    passenger.destinationAisleRow = undefined;
    passenger.movementSecondsRemaining = 0;
    passenger.movementStepSecondsRemaining = 0;
  });
  refreshAisleCells(state);
}

function queueAisleRow(state: SimulationState, lavatory: Lavatory, queuePosition: number): number {
  const direction = lavatory.row <= 1 ? 1 : -1;
  return clamp(lavatory.row + direction * queuePosition, 1, state.config.aircraft.rows);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function buildSeats(config: LevelConfig): Array<{ row: number; seat: string }> {
  const seats: Array<{ row: number; seat: string }> = [];
  for (let row = 1; row <= config.aircraft.rows; row += 1) {
    for (const seat of config.aircraft.seatLayout) {
      seats.push({ row, seat });
    }
  }
  return seats;
}

function buildArchetypeList(config: LevelConfig, seatCount: number): PassengerArchetype[] {
  const archetypes: PassengerArchetype[] = [];
  for (const archetype of ARCHETYPE_ORDER) {
    const count = config.passengerMix[archetype] ?? 0;
    for (let index = 0; index < count; index += 1) {
      archetypes.push(archetype);
    }
  }

  while (archetypes.length < seatCount) {
    archetypes.push("normal");
  }

  return archetypes.slice(0, seatCount);
}

function validateConfig(config: LevelConfig): void {
  if (config.aircraft.rows < 1) {
    throw new Error("aircraft.rows must be at least 1");
  }
  if (config.aircraft.seatLayout.length < 1) {
    throw new Error("aircraft.seatLayout must contain seats");
  }
  if (config.aircraft.lavatories.length < 1) {
    throw new Error("aircraft.lavatories must contain lavatories");
  }
  if (!Number.isFinite(config.durationSeconds) || config.durationSeconds <= 0) {
    throw new Error("durationSeconds must be a positive finite number");
  }
  if (!isUnitInterval(config.bladder.initialFillRange[0]) || !isUnitInterval(config.bladder.initialFillRange[1])) {
    throw new Error("initialFillRange must be between 0 and 1");
  }
  if (config.bladder.initialFillRange[0] > config.bladder.initialFillRange[1]) {
    throw new Error("initialFillRange minimum must be <= maximum");
  }
  if (config.bladder.baseFillPerSecond < 0) {
    throw new Error("bladder.baseFillPerSecond must be non-negative");
  }
  if (
    !isUnitInterval(config.bladder.requestThreshold) ||
    !isUnitInterval(config.bladder.desperateThreshold)
  ) {
    throw new Error("bladder thresholds must be between 0 and 1");
  }
  if (config.bladder.requestThreshold > config.bladder.desperateThreshold) {
    throw new Error("bladder.requestThreshold must be <= desperateThreshold");
  }
  if (config.lavatory.minimumWalkSeconds < 0 || config.lavatory.walkSecondsPerRow < 0) {
    throw new Error("lavatory walk timings must be non-negative");
  }
  if (config.lavatory.useDurationSeconds[0] <= 0 || config.lavatory.useDurationSeconds[1] <= 0) {
    throw new Error("lavatory use duration must be positive");
  }
  if (config.lavatory.useDurationSeconds[0] > config.lavatory.useDurationSeconds[1]) {
    throw new Error("lavatory use duration minimum must be <= maximum");
  }
  if (
    config.lavatory.passingSlowdownMultiplier !== undefined &&
    config.lavatory.passingSlowdownMultiplier < 1
  ) {
    throw new Error("lavatory.passingSlowdownMultiplier must be at least 1");
  }
  if (
    config.seatBlockers.standSeconds < 0 ||
    config.seatBlockers.sitSeconds < 0 ||
    config.seatBlockers.standCooldownSeconds < 0
  ) {
    throw new Error("seat blocker timings must be non-negative");
  }
  if (config.beverageCart !== undefined) {
    if (config.beverageCart.serviceRows.length < 1) {
      throw new Error("beverageCart.serviceRows must contain rows");
    }
    if (config.beverageCart.serviceRows.some((row) => !Number.isInteger(row))) {
      throw new Error("beverageCart.serviceRows must be row numbers");
    }
    if (
      config.beverageCart.rowServiceSeconds[0] < 0 ||
      config.beverageCart.rowServiceSeconds[1] < 0 ||
      config.beverageCart.rowServiceSeconds[0] > config.beverageCart.rowServiceSeconds[1]
    ) {
      throw new Error("beverageCart.rowServiceSeconds must be a non-negative range");
    }
    if (config.beverageCart.moveSecondsPerRow < 0) {
      throw new Error("beverageCart.moveSecondsPerRow must be non-negative");
    }
    if (config.beverageCart.bladderRateMultiplier < 0) {
      throw new Error("beverageCart.bladderRateMultiplier must be non-negative");
    }
    if (
      config.beverageCart.bladderRateDelaySeconds < 0 ||
      config.beverageCart.bladderRateDurationSeconds < 0
    ) {
      throw new Error("beverage cart bladder modifier timings must be non-negative");
    }
  }
  if (config.turbulence !== undefined) {
    if (config.turbulence.warningSeconds < 0) {
      throw new Error("turbulence.warningSeconds must be non-negative");
    }
    if (
      config.turbulence.durationSeconds[0] < 0 ||
      config.turbulence.durationSeconds[1] < 0 ||
      config.turbulence.durationSeconds[0] > config.turbulence.durationSeconds[1]
    ) {
      throw new Error("turbulence.durationSeconds must be a non-negative range");
    }
    if (!isUnitInterval(config.turbulence.seatBeltSignChance)) {
      throw new Error("turbulence.seatBeltSignChance must be between 0 and 1");
    }
    if (
      config.turbulence.autoStartSeconds !== undefined &&
      config.turbulence.autoStartSeconds < 0
    ) {
      throw new Error("turbulence.autoStartSeconds must be non-negative");
    }
  }
  if (config.babyDiaper !== undefined) {
    validateNonNegativeRange(config.babyDiaper.firstEventSeconds, "babyDiaper.firstEventSeconds");
    validateNonNegativeRange(config.babyDiaper.repeatEventSeconds, "babyDiaper.repeatEventSeconds");
    if (
      config.babyDiaper.changeDurationSeconds[0] <= 0 ||
      config.babyDiaper.changeDurationSeconds[1] <= 0 ||
      config.babyDiaper.changeDurationSeconds[0] > config.babyDiaper.changeDurationSeconds[1]
    ) {
      throw new Error("babyDiaper.changeDurationSeconds must be a positive range");
    }
  }
  if (config.loss.maxStrikes < 1) {
    throw new Error("loss.maxStrikes must be at least 1");
  }

  function validateNonNegativeRange(range: [number, number], name: string): void {
    if (range[0] < 0 || range[1] < 0 || range[0] > range[1]) {
      throw new Error(`${name} must be a non-negative range`);
    }
  }
  if (config.loss.panicGraceSeconds < 0) {
    throw new Error("loss.panicGraceSeconds must be non-negative");
  }
  if (!isUnitInterval(config.loss.strikeRecoveryFillPercent)) {
    throw new Error("loss.strikeRecoveryFillPercent must be between 0 and 1");
  }
}

function isUnitInterval(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}

function toUrgency(passenger: Passenger): PassengerUrgency {
  return {
    id: passenger.id,
    row: passenger.row,
    seat: passenger.seat,
    archetype: passenger.archetype,
    state: passenger.state,
    bladderPercent: bladderPercent(passenger),
    strikeCount: passenger.strikeCount,
    assignedLavatoryId: passenger.assignedLavatoryId,
    aisleRow: passenger.aisleRow,
    queuePosition: passenger.queuePosition,
    blockingPassengerId: passenger.blockingPassengerId,
    standCooldownSecondsRemaining: passenger.standCooldownSecondsRemaining,
    beverageRateMultiplier: passenger.beverageRateMultiplier,
    beverageRateModifierStartSeconds: passenger.beverageRateModifierStartSeconds,
    beverageRateModifierEndSeconds: passenger.beverageRateModifierEndSeconds,
    babyDiaperNeedsChange: passenger.babyDiaperNeedsChange,
    babyDiaperSecondsRemaining: passenger.babyDiaperSecondsRemaining,
    babyDiaperChangeCount: passenger.babyDiaperChangeCount
  };
}

function walkSecondsForPassenger(state: SimulationState, passenger: Passenger, lavatory: Lavatory): number {
  return (
    state.config.lavatory.minimumWalkSeconds +
    Math.abs(passenger.row - lavatory.row) * state.config.lavatory.walkSecondsPerRow
  );
}

function lavatoryUseSeconds(state: SimulationState, passenger: Passenger): number {
  if (passenger.babyDiaperNeedsChange) {
    return babyDiaperChangeSeconds(state, passenger);
  }

  const [min, max] = state.config.lavatory.useDurationSeconds;
  if (min === max) {
    return min;
  }

  const hash = hashString(`${state.config.seed}:${passenger.id}:${passenger.lavatoryVisitCount}`);
  return min + (max - min) * hash;
}

function babyDiaperChangeSeconds(state: SimulationState, passenger: Passenger): number {
  const config = state.config.babyDiaper;
  if (config === undefined) {
    return lavatoryUseSeconds(state, { ...passenger, babyDiaperNeedsChange: false });
  }

  const [min, max] = config.changeDurationSeconds;
  if (min === max) {
    return min;
  }

  const hash = hashString(`${state.config.seed}:${passenger.id}:baby-diaper:${passenger.babyDiaperChangeCount}`);
  return min + (max - min) * hash;
}

function babyDiaperEventSeconds(config: LevelConfig, key: string): number | undefined {
  const diaperConfig = config.babyDiaper;
  if (diaperConfig === undefined) {
    return undefined;
  }

  const range = key.startsWith("first:") ? diaperConfig.firstEventSeconds : diaperConfig.repeatEventSeconds;
  const [min, max] = range;
  if (min === max) {
    return min;
  }

  return min + (max - min) * hashString(`${config.seed}:baby-diaper:${key}`);
}

function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function findPassenger(state: SimulationState, passengerId: string): Passenger {
  const passenger = state.passengers.find((candidate) => candidate.id === passengerId);
  if (passenger === undefined) {
    throw new Error(`Unknown passenger: ${passengerId}`);
  }
  return passenger;
}

function findLavatory(state: SimulationState, lavatoryId: string): Lavatory {
  const lavatory = state.lavatories.find((candidate) => candidate.id === lavatoryId);
  if (lavatory === undefined) {
    throw new Error(`Unknown lavatory: ${lavatoryId}`);
  }
  return lavatory;
}

function removeFromLavatoryQueue(state: SimulationState, passengerId: string): void {
  for (const lavatory of state.lavatories) {
    const previousLength = lavatory.queue.length;
    lavatory.queue = lavatory.queue.filter((queuedPassengerId) => queuedPassengerId !== passengerId);
    if (lavatory.queue.length !== previousLength) {
      updateLavatoryQueuePositions(state, lavatory);
    }
  }
}

function abandonLavatoryAssignment(state: SimulationState, passenger: Passenger): void {
  const blockedPassengerId = passenger.blockingPassengerId;
  releaseSeatBlockers(state, passenger.id);
  passenger.assignedLavatoryId = undefined;
  passenger.aisleRow = undefined;
  passenger.destinationAisleRow = undefined;
  passenger.queuePosition = undefined;
  passenger.blockingPassengerId = undefined;
  passenger.movementStepSecondsRemaining = 0;
  passenger.movementSecondsRemaining = 0;
  passenger.standSecondsRemaining = 0;
  passenger.sitSecondsRemaining = 0;
  passenger.lavatorySecondsRemaining = 0;
  removeFromLavatoryQueue(state, passenger.id);
  if (blockedPassengerId !== undefined) {
    const blockedPassenger = state.passengers.find((candidate) => candidate.id === blockedPassengerId);
    if (
      blockedPassenger !== undefined &&
      (blockedPassenger.state === "Standing" ||
        blockedPassenger.state === "WaitingForSeatBlockers")
    ) {
      blockedPassenger.state = "WaitingForSeatBlockers";
      blockedPassenger.aisleRow = undefined;
      blockedPassenger.standSecondsRemaining = 0;
    }
  }
  refreshAisleCells(state);
}

function requireAssignedLavatory(passenger: Passenger): string {
  if (passenger.assignedLavatoryId === undefined) {
    throw new Error(`${passenger.id} has no assigned lavatory`);
  }
  return passenger.assignedLavatoryId;
}

function addEvent(
  state: SimulationState,
  type: SimulationEvent["type"],
  message: string,
  passengerId?: string,
  lavatoryId?: string
): void {
  state.events.push({
    time: Number(state.time.toFixed(6)),
    type,
    passengerId,
    lavatoryId,
    message
  });
}
