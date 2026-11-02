import { bladderPercent } from "./simulation";
import type { Lavatory, Passenger, SimulationState } from "./types";

export function canDispatch(state: SimulationState, passenger: Passenger): boolean {
  return state.status === "running" && state.turbulence?.phase !== "active" &&
    !["UsingLavatory", "ReturningToSeat", "Sitting"].includes(passenger.state);
}

export function secondsUntilAccident(state: SimulationState, passenger: Passenger): number {
  if (passenger.state === "UsingLavatory") {
    return Infinity;
  }
  const rate = state.config.bladder.baseFillPerSecond * passenger.bladderRateMultiplier;
  let remaining = Math.max(0, passenger.capacity - passenger.rawBladder);
  let cursor = state.time;
  const start = passenger.beverageRateModifierStartSeconds;
  const end = passenger.beverageRateModifierEndSeconds;
  const boundaries = [start, end].filter((time): time is number => time !== undefined && time > cursor)
    .sort((a, b) => a - b);
  let seconds = 0;
  for (const boundary of [...boundaries, Infinity]) {
    const multiplier = start !== undefined && end !== undefined && cursor >= start && cursor < end
      ? state.config.beverageCart?.bladderRateMultiplier ?? 1 : 1;
    const fillRate = rate * multiplier;
    const interval = boundary - cursor;
    if (remaining === 0 || (fillRate > 0 && remaining / fillRate <= interval)) {
      seconds += remaining === 0 ? 0 : remaining / fillRate;
      remaining = 0;
      break;
    }
    if (boundary === Infinity) {
      seconds = Infinity;
      break;
    }
    remaining -= fillRate * interval;
    seconds += interval;
    cursor = boundary;
  }
  const bladderDeadline = seconds + Math.max(0, state.config.loss.panicGraceSeconds - passenger.panicSeconds);
  const diaperDeadline = passenger.babyDiaperNeedsChange && state.config.babyDiaper?.patienceSeconds !== undefined
    ? Math.max(0, state.config.babyDiaper.patienceSeconds - passenger.babyDiaperWaitSeconds) : Infinity;
  return Math.min(bladderDeadline, diaperDeadline);
}

export function expectedUseSeconds(state: SimulationState, passenger: Passenger): number {
  const range = passenger.babyDiaperNeedsChange && state.config.babyDiaper !== undefined
    ? state.config.babyDiaper.changeDurationSeconds : state.config.lavatory.useDurationSeconds;
  return (range[0] + range[1]) / 2;
}

export function cartBlocksRoute(state: SimulationState, passenger: Passenger, destinationRow: number): boolean {
  const cart = state.beverageCart;
  if (cart === undefined || cart.parked || state.turbulence?.phase === "active" ||
      !["moving", "servicing"].includes(cart.state)) {
    return false;
  }
  const row = passenger.aisleRow ?? passenger.row;
  return cart.currentAisleRow >= Math.min(row, destinationRow) &&
    cart.currentAisleRow <= Math.max(row, destinationRow);
}

export function estimateLavatoryEntry(state: SimulationState, passenger: Passenger, lavatory: Lavatory): number {
  if (lavatory.occupantPassengerId === passenger.id) {
    return 0;
  }
  const row = passenger.aisleRow ?? passenger.row;
  let walk = state.config.lavatory.minimumWalkSeconds +
    Math.abs(row - lavatory.row) * state.config.lavatory.walkSecondsPerRow;
  if (passenger.aisleRow === undefined) {
    walk += state.config.seatBlockers.standSeconds + passenger.standCooldownSecondsRemaining;
  }
  if (cartBlocksRoute(state, passenger, lavatory.row)) {
    walk += state.beverageCart?.serviceSecondsRemaining ?? 0;
  }
  let workload = 0;
  for (const other of state.passengers) {
    if (other.id === passenger.id || other.assignedLavatoryId !== lavatory.id ||
        other.state === "ReturningToSeat" || other.state === "Sitting") {
      continue;
    }
    workload += other.state === "UsingLavatory" ? other.lavatorySecondsRemaining : expectedUseSeconds(state, other);
  }
  return Math.max(walk, workload);
}

export function recommendLavatory(state: SimulationState, passenger: Passenger): Lavatory {
  return [...state.lavatories].sort((a, b) =>
    estimateLavatoryEntry(state, passenger, a) - estimateLavatoryEntry(state, passenger, b) ||
    a.id.localeCompare(b.id))[0];
}

export function remainingServiceSeconds(state: SimulationState): number {
  const cart = state.beverageCart;
  const config = state.config.beverageCart;
  if (cart === undefined || config === undefined || cart.state === "complete") {
    return 0;
  }
  const average = (config.rowServiceSeconds[0] + config.rowServiceSeconds[1]) / 2;
  let seconds = cart.maneuverSecondsRemaining;
  for (let index = cart.serviceRowIndex; index < config.serviceRows.length; index += 1) {
    seconds += index === cart.serviceRowIndex && cart.state === "servicing"
      ? cart.serviceSecondsRemaining : average;
    const previousRow = index === cart.serviceRowIndex ? cart.currentAisleRow : config.serviceRows[index - 1];
    seconds += Math.abs(config.serviceRows[index] - previousRow) * config.moveSecondsPerRow;
  }
  return seconds;
}

export function serviceSlackSeconds(state: SimulationState): number {
  const turbulence = state.config.turbulence;
  let stop = state.turbulence?.activeSecondsRemaining ?? 0;
  if (turbulence?.autoStartSeconds !== undefined && !state.turbulence?.hasAutoStarted &&
      turbulence.seatBeltSignChance > 0) {
    stop += turbulence.durationSeconds[1];
  } else if (state.turbulence?.phase === "warning" && state.turbulence.willTurnSeatBeltSignOn) {
    stop += turbulence?.durationSeconds[1] ?? 0;
  }
  return state.config.durationSeconds - state.time - remainingServiceSeconds(state) - stop;
}

export function needsHelp(state: SimulationState, passenger: Passenger): boolean {
  return bladderPercent(passenger) >= state.config.bladder.requestThreshold || passenger.babyDiaperNeedsChange;
}
