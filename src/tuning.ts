import { createInitialState, assignPassengerToLavatory, setBeverageCartParked, tick } from "./simulation";
import {
  canDispatch, cartBlocksRoute, estimateLavatoryEntry, needsHelp, recommendLavatory,
  secondsUntilAccident, serviceSlackSeconds
} from "./dispatch";
import type { LevelConfig, SimulationState } from "./types";

export const tuningPolicies = ["hands-off", "reactive", "assisted", "planner", "never-park", "always-park"] as const;
export type TuningPolicy = typeof tuningPolicies[number];

export interface TuningResult {
  seed: number;
  policy: TuningPolicy;
  won: boolean;
  strikes: number;
  failureReason?: SimulationState["failureReason"];
  commands: number;
  visits: number;
  served: number;
  diapersChanged: number;
  firstDecisionSeconds?: number;
  maxQueue: number;
  busySecondsByWindow: number[];
  parkedSeconds: number;
}

// Each policy gets at most one command every two seconds, including cart commands.
export function tuningStep(state: SimulationState, policy: TuningPolicy): number {
  if (state.status !== "running" || policy === "hands-off" || state.turbulence?.phase === "active") {
    return 0;
  }
  const cart = state.beverageCart;
  if (policy === "always-park" && cart !== undefined && !cart.parked &&
      ["moving", "servicing"].includes(cart.state) && cart.maneuverSecondsRemaining === 0) {
    setBeverageCartParked(state, true);
    return 1;
  }
  if (policy === "planner" && cart !== undefined && ["moving", "servicing"].includes(cart.state) &&
      cart.maneuverSecondsRemaining === 0) {
    const blocked = state.passengers.some((passenger) =>
      passenger.destinationAisleRow !== undefined && passenger.aisleRow !== undefined &&
      (cart.parked
        ? cart.currentAisleRow >= Math.min(passenger.aisleRow, passenger.destinationAisleRow) &&
          cart.currentAisleRow <= Math.max(passenger.aisleRow, passenger.destinationAisleRow)
        : cartBlocksRoute(state, passenger, passenger.destinationAisleRow)) &&
      (secondsUntilAccident(state, passenger) < 28 || passenger.state === "ReturningToSeat"));
    const shouldPark = blocked && serviceSlackSeconds(state) > 8;
    if (cart.parked !== shouldPark) {
      setBeverageCartParked(state, shouldPark);
      return 1;
    }
  }
  const planning = policy !== "reactive" && policy !== "assisted";
  const candidates = state.passengers.filter((passenger) =>
    canDispatch(state, passenger) && passenger.assignedLavatoryId === undefined &&
    (planning ? secondsUntilAccident(state, passenger) < Math.min(42, state.config.durationSeconds - state.time) :
      needsHelp(state, passenger)));
  candidates.sort((a, b) => secondsUntilAccident(state, a) - secondsUntilAccident(state, b) || a.id.localeCompare(b.id));
  for (const passenger of candidates) {
    const lavatory = policy === "reactive" ? [...state.lavatories].sort((a, b) =>
      Math.abs(passenger.row - a.row) - Math.abs(passenger.row - b.row) || a.id.localeCompare(b.id))[0]
      : recommendLavatory(state, passenger);
    if (planning && state.turbulence?.phase === "warning" &&
        estimateLavatoryEntry(state, passenger, lavatory) + 1 > state.turbulence.warningSecondsRemaining) {
      continue;
    }
    assignPassengerToLavatory(state, passenger.id, lavatory.id);
    return 1;
  }
  return 0;
}

export function runTuningSimulation(config: LevelConfig, policy: TuningPolicy): TuningResult {
  const state = createInitialState(config);
  const result: TuningResult = {
    seed: config.seed, policy, won: false, strikes: 0, commands: 0, visits: 0,
    served: 0, diapersChanged: 0, maxQueue: 0,
    busySecondsByWindow: Array.from({ length: Math.ceil(config.durationSeconds / 30) }, () => 0),
    parkedSeconds: 0
  };
  let nextDecision = 0;
  while (state.status === "running") {
    if (result.firstDecisionSeconds === undefined && state.passengers.some((passenger) => needsHelp(state, passenger))) {
      result.firstDecisionSeconds = state.time;
    }
    if (state.time + 0.00001 >= nextDecision) {
      result.commands += tuningStep(state, policy);
      nextDecision += 2;
    }
    const dt = Math.min(0.1, config.durationSeconds - state.time);
    const window = Math.min(result.busySecondsByWindow.length - 1, Math.floor(state.time / 30));
    result.busySecondsByWindow[window] += state.lavatories.filter((lavatory) => lavatory.occupantPassengerId !== undefined).length * dt;
    if (state.beverageCart?.parked) {
      result.parkedSeconds += dt;
    }
    result.maxQueue = Math.max(result.maxQueue, ...state.lavatories.map((lavatory) => lavatory.queue.length));
    tick(state, dt);
  }
  result.won = state.status === "won";
  result.strikes = state.strikes;
  result.failureReason = state.failureReason;
  result.visits = state.passengers.reduce((sum, passenger) => sum + passenger.lavatoryVisitCount, 0);
  result.diapersChanged = state.passengers.reduce((sum, passenger) => sum + passenger.babyDiaperChangeCount, 0);
  result.served = state.beverageCart?.passengerIdsServed.length ?? 0;
  return result;
}
