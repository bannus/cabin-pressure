import { ARCHETYPES } from "./archetypes";
import { SeededRng } from "./rng";
import type {
  AisleCell,
  Lavatory,
  LevelConfig,
  Passenger,
  PassengerArchetype,
  PassengerState,
  PassengerUrgency,
  SimulationEvent,
  SimulationState,
  SimulationSummary
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
      movementStepSecondsRemaining: 0,
      movementSecondsRemaining: 0,
      lavatorySecondsRemaining: 0,
      lavatoryVisitCount: 0,
      standSecondsRemaining: 0,
      sitSecondsRemaining: 0,
      standCooldownSecondsRemaining: 0
    };
  });

  return {
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
    events: []
  };
}

export function tick(state: SimulationState, dt: number): SimulationState {
  if (dt <= 0) {
    throw new Error("dt must be positive");
  }

  if (state.status !== "running") {
    return state;
  }

  state.time = Math.min(state.time + dt, state.config.durationSeconds);

  updateLavatoryProgress(state, dt);

  for (const passenger of state.passengers) {
    if (passenger.state === "UsingLavatory") {
      continue;
    }

    const lost = updatePassengerBladder(state, passenger, dt);
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
      passengerIds: [...cell.passengerIds]
    })),
    lavatories: state.lavatories.map((lavatory) => ({
      id: lavatory.id,
      row: lavatory.row,
      occupantPassengerId: lavatory.occupantPassengerId,
      queue: [...lavatory.queue]
    })),
    mostUrgent: urgency.slice(0, urgentLimit)
  };
}

export function bladderPercent(passenger: Passenger): number {
  return Math.min(passenger.rawBladder / passenger.capacity, 1);
}

function updateLavatoryProgress(state: SimulationState, dt: number): void {
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
  passenger.rawBladder +=
    state.config.bladder.baseFillPerSecond * passenger.bladderRateMultiplier * dt;

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

  if (passenger.movementStepSecondsRemaining === 0) {
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
      passenger.movementStepSecondsRemaining = nextAisleStepSeconds(state, passenger);
    }

    if (passenger.movementStepSecondsRemaining === 0) {
      passenger.aisleRow = nextAisleRow(passenger);
      refreshAisleCells(state);
      continue;
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
  const cells: AisleCell[] = [];
  const lavatoryRows = config.aircraft.lavatories.map((lavatory) => lavatory.row);
  const minRow = Math.min(1, ...lavatoryRows);
  const maxRow = Math.max(config.aircraft.rows, ...lavatoryRows);
  for (let row = minRow; row <= maxRow; row += 1) {
    cells.push({
      row,
      passengerIds: passengers
        .filter((passenger) => isInAisle(passenger) && passenger.aisleRow === row)
        .map((passenger) => passenger.id)
    });
  }
  return cells;
}

function refreshAisleCells(state: SimulationState): void {
  state.aisleCells = buildAisleCells(state.config, state.passengers);
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
  if (config.durationSeconds <= 0) {
    throw new Error("durationSeconds must be positive");
  }
  if (config.bladder.initialFillRange[0] < 0 || config.bladder.initialFillRange[1] > 1) {
    throw new Error("initialFillRange must be between 0 and 1");
  }
  if (config.bladder.initialFillRange[0] > config.bladder.initialFillRange[1]) {
    throw new Error("initialFillRange minimum must be <= maximum");
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
  if (config.loss.maxStrikes < 1) {
    throw new Error("loss.maxStrikes must be at least 1");
  }
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
    standCooldownSecondsRemaining: passenger.standCooldownSecondsRemaining
  };
}

function walkSecondsForPassenger(state: SimulationState, passenger: Passenger, lavatory: Lavatory): number {
  return (
    state.config.lavatory.minimumWalkSeconds +
    Math.abs(passenger.row - lavatory.row) * state.config.lavatory.walkSecondsPerRow
  );
}

function lavatoryUseSeconds(state: SimulationState, passenger: Passenger): number {
  const [min, max] = state.config.lavatory.useDurationSeconds;
  if (min === max) {
    return min;
  }

  const hash = hashString(`${state.config.seed}:${passenger.id}:${passenger.lavatoryVisitCount}`);
  return min + (max - min) * hash;
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
