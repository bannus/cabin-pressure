import {
  assignPassengerToLavatory,
  bladderPercent,
  createInitialState,
  startBeverageCart,
  summarize,
  tick
} from "./simulation";
import type {
  LevelConfig,
  Lavatory,
  Passenger,
  PassengerState,
  SimulationState,
  SimulationStatus
} from "./types";

export interface AssignmentDecision {
  passengerId: string;
  lavatoryId: string;
}

export interface BotStrategy {
  name: string;
  decide(state: SimulationState): AssignmentDecision[];
}

export interface BotOptions {
  dt?: number;
  strategy?: BotStrategy;
  startBeverageCart?: boolean;
  /**
   * Cap on how many lavatory assignments the bot may make per minute, modelling a
   * human's limited actions-per-minute. Undefined (or non-finite) means unlimited.
   */
  actionsPerMinute?: number;
}

export interface BotRunResult {
  configId: string;
  configName: string;
  strategy: string;
  seed: number;
  actionsPerMinute: number;
  durationSeconds: number;
  finalTime: number;
  status: SimulationStatus;
  strikes: number;
  assignmentsMade: number;
  panicEvents: number;
  strikeEvents: number;
  lavatoryVisits: number;
  babyDiaperChanges: number;
  maxQueueLength: number;
  averageBladderPercent: number;
  peakConcurrentDemand: number;
  meanConcurrentDemand: number;
  demandSpikiness: number;
  lavatoryUtilization: number;
  busyFraction: number;
}

const DEFAULT_DT = 0.1;

const DEMAND_STATES: ReadonlySet<PassengerState> = new Set<PassengerState>([
  "NeedsToGo",
  "WaitingForSeatBlockers",
  "Standing",
  "WalkingToLavatory",
  "QueuedForLavatory",
  "Panic"
]);

const ASSIGNABLE_STATES: ReadonlySet<PassengerState> = new Set<PassengerState>([
  "NeedsToGo",
  "Panic"
]);

export function urgencyScore(passenger: Passenger): number {
  return (
    bladderPercent(passenger) * 100 +
    (passenger.state === "Panic" ? 50 : 0) +
    (passenger.babyDiaperNeedsChange ? 35 : 0) +
    (passenger.state === "NeedsToGo" ? 15 : 0)
  );
}

function needsAssignment(passenger: Passenger): boolean {
  return passenger.assignedLavatoryId === undefined && ASSIGNABLE_STATES.has(passenger.state);
}

function sortByUrgency(passengers: Passenger[]): Passenger[] {
  return [...passengers].sort((left, right) => {
    const delta = urgencyScore(right) - urgencyScore(left);
    if (delta !== 0) {
      return delta;
    }
    return left.id.localeCompare(right.id);
  });
}

function lavatoryLoad(lavatory: Lavatory, tentative: Map<string, number>): number {
  return (
    lavatory.queue.length +
    (lavatory.occupantPassengerId === undefined ? 0 : 1) +
    (tentative.get(lavatory.id) ?? 0)
  );
}

export function chooseLavatory(
  state: SimulationState,
  passenger: Passenger,
  tentative: Map<string, number>
): Lavatory {
  const walkSecondsPerRow = state.config.lavatory.walkSecondsPerRow;
  const averageUseSeconds =
    (state.config.lavatory.useDurationSeconds[0] + state.config.lavatory.useDurationSeconds[1]) / 2;

  return [...state.lavatories]
    .map((lavatory) => {
      const walkCost = Math.abs(passenger.row - lavatory.row) * walkSecondsPerRow;
      const queueCost = lavatoryLoad(lavatory, tentative) * averageUseSeconds;
      return { lavatory, cost: walkCost + queueCost };
    })
    .sort((left, right) => {
      if (left.cost !== right.cost) {
        return left.cost - right.cost;
      }
      return left.lavatory.id.localeCompare(right.lavatory.id);
    })[0].lavatory;
}

function nearestLavatory(state: SimulationState, passenger: Passenger): Lavatory {
  return [...state.lavatories].sort((left, right) => {
    const delta = Math.abs(passenger.row - left.row) - Math.abs(passenger.row - right.row);
    if (delta !== 0) {
      return delta;
    }
    return left.id.localeCompare(right.id);
  })[0];
}

export const greedyStrategy: BotStrategy = {
  name: "greedy",
  decide(state: SimulationState): AssignmentDecision[] {
    const candidates = sortByUrgency(state.passengers.filter(needsAssignment));
    const tentative = new Map<string, number>();
    const decisions: AssignmentDecision[] = [];

    for (const passenger of candidates) {
      const lavatory = chooseLavatory(state, passenger, tentative);
      tentative.set(lavatory.id, (tentative.get(lavatory.id) ?? 0) + 1);
      decisions.push({ passengerId: passenger.id, lavatoryId: lavatory.id });
    }

    return decisions;
  }
};

export const panicStrategy: BotStrategy = {
  name: "panic",
  decide(state: SimulationState): AssignmentDecision[] {
    return state.passengers
      .filter(
        (passenger) => passenger.assignedLavatoryId === undefined && passenger.state === "Panic"
      )
      .map((passenger) => ({
        passengerId: passenger.id,
        lavatoryId: nearestLavatory(state, passenger).id
      }));
  }
};

export const fixedLavatoryStrategy: BotStrategy = {
  name: "fixed-lavatory",
  decide(state: SimulationState): AssignmentDecision[] {
    const target = state.lavatories[0];
    if (target === undefined) {
      return [];
    }
    return state.passengers
      .filter(needsAssignment)
      .map((passenger) => ({ passengerId: passenger.id, lavatoryId: target.id }));
  }
};

/** Total passengers currently occupying the aisle (walking, queued, or in transit). */
function aisleOccupancy(state: SimulationState): number {
  let occupancy = 0;
  for (const cell of state.aisleCells) {
    occupancy += cell.passengerIds.length;
  }
  return occupancy;
}

const DEFAULT_MAX_CONCURRENT_WALKERS = 10;
const FLOW_CRITICAL_BLADDER_PERCENT = 0.95;

/**
 * Models the core skill of the game: metering aisle flow. Releases the most urgent
 * passengers to the nearest/least-loaded lavatory but stops once the aisle already
 * holds `maxConcurrentWalkers` people, so the single-file aisle never jams.
 * Passengers in immediate danger (panic or near-full bladder) are always released.
 *
 * Empirically this is the dominant strategy under aisle congestion: capping
 * concurrent walkers to ~6-12 wins effectively every run regardless of APM, whereas
 * flooding the aisle collapses throughput. It is the honest "skilled play" benchmark.
 */
export function makeFlowControlStrategy(
  maxConcurrentWalkers = DEFAULT_MAX_CONCURRENT_WALKERS
): BotStrategy {
  return {
    name: "flow-control",
    decide(state: SimulationState): AssignmentDecision[] {
      const candidates = sortByUrgency(state.passengers.filter(needsAssignment));
      const tentative = new Map<string, number>();
      const decisions: AssignmentDecision[] = [];
      let walkers = aisleOccupancy(state);

      for (const passenger of candidates) {
        const critical =
          passenger.state === "Panic" ||
          bladderPercent(passenger) >= FLOW_CRITICAL_BLADDER_PERCENT;
        if (!critical && walkers >= maxConcurrentWalkers) {
          continue;
        }
        const lavatory = chooseLavatory(state, passenger, tentative);
        tentative.set(lavatory.id, (tentative.get(lavatory.id) ?? 0) + 1);
        decisions.push({ passengerId: passenger.id, lavatoryId: lavatory.id });
        walkers += 1;
      }

      return decisions;
    }
  };
}

export const flowControlStrategy: BotStrategy = makeFlowControlStrategy();

export const BOT_STRATEGIES: Record<string, BotStrategy> = {
  [greedyStrategy.name]: greedyStrategy,
  [panicStrategy.name]: panicStrategy,
  [fixedLavatoryStrategy.name]: fixedLavatoryStrategy,
  [flowControlStrategy.name]: flowControlStrategy
};

export function applyDecisions(state: SimulationState, decisions: AssignmentDecision[]): number {
  let assignmentsMade = 0;

  for (const decision of decisions) {
    try {
      assignPassengerToLavatory(state, decision.passengerId, decision.lavatoryId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("seat belt sign")) {
        return assignmentsMade;
      }
      continue;
    }
    assignmentsMade += 1;
  }

  return assignmentsMade;
}

export function botStep(
  state: SimulationState,
  strategy: BotStrategy = greedyStrategy,
  maxActions = Number.POSITIVE_INFINITY
): number {
  if (state.status !== "running" || maxActions <= 0) {
    return 0;
  }
  const decisions = strategy.decide(state);
  if (!Number.isFinite(maxActions) || decisions.length <= maxActions) {
    return applyDecisions(state, decisions);
  }

  // Under an actions-per-minute cap, spend the limited budget on the most urgent
  // passengers first so the cap models a human triaging the worst cases.
  const byId = new Map(state.passengers.map((passenger) => [passenger.id, passenger]));
  const prioritized = [...decisions].sort((left, right) => {
    const leftPassenger = byId.get(left.passengerId);
    const rightPassenger = byId.get(right.passengerId);
    const delta =
      (rightPassenger ? urgencyScore(rightPassenger) : 0) -
      (leftPassenger ? urgencyScore(leftPassenger) : 0);
    if (delta !== 0) {
      return delta;
    }
    return left.passengerId.localeCompare(right.passengerId);
  });
  return applyDecisions(state, prioritized.slice(0, Math.floor(maxActions)));
}

interface MetricAccumulator {
  assignmentsMade: number;
  maxQueueLength: number;
  peakConcurrentDemand: number;
  demandSamples: number;
  demandTotal: number;
  busySamples: number;
  occupiedLavatorySeconds: number;
  totalLavatorySeconds: number;
}

function sampleMetrics(state: SimulationState, dt: number, metrics: MetricAccumulator): void {
  let demand = 0;
  for (const passenger of state.passengers) {
    if (DEMAND_STATES.has(passenger.state)) {
      demand += 1;
    }
  }

  metrics.demandSamples += 1;
  metrics.demandTotal += demand;
  if (demand > metrics.peakConcurrentDemand) {
    metrics.peakConcurrentDemand = demand;
  }
  if (demand > 0) {
    metrics.busySamples += 1;
  }

  let occupied = 0;
  for (const lavatory of state.lavatories) {
    if (lavatory.occupantPassengerId !== undefined) {
      occupied += 1;
    }
    if (lavatory.queue.length > metrics.maxQueueLength) {
      metrics.maxQueueLength = lavatory.queue.length;
    }
  }

  metrics.occupiedLavatorySeconds += occupied * dt;
  metrics.totalLavatorySeconds += state.lavatories.length * dt;
}

export function runBotSimulation(config: LevelConfig, options: BotOptions = {}): BotRunResult {
  const dt = options.dt ?? DEFAULT_DT;
  const strategy = options.strategy ?? greedyStrategy;
  const apm = options.actionsPerMinute;
  const apmLimited = apm !== undefined && Number.isFinite(apm);
  const state = createInitialState(config);

  if (options.startBeverageCart && state.beverageCart !== undefined) {
    startBeverageCart(state);
  }

  const metrics: MetricAccumulator = {
    assignmentsMade: 0,
    maxQueueLength: 0,
    peakConcurrentDemand: 0,
    demandSamples: 0,
    demandTotal: 0,
    busySamples: 0,
    occupiedLavatorySeconds: 0,
    totalLavatorySeconds: 0
  };

  let actionBudget = 0;

  while (state.status === "running") {
    if (apmLimited) {
      actionBudget += ((apm as number) * dt) / 60;
      const made = botStep(state, strategy, Math.floor(actionBudget));
      actionBudget -= made;
      metrics.assignmentsMade += made;
    } else {
      metrics.assignmentsMade += botStep(state, strategy);
    }
    sampleMetrics(state, dt, metrics);
    tick(state, dt);
  }

  return buildResult(config, strategy, apmLimited ? (apm as number) : Number.POSITIVE_INFINITY, state, metrics);
}

function buildResult(
  config: LevelConfig,
  strategy: BotStrategy,
  actionsPerMinute: number,
  state: SimulationState,
  metrics: MetricAccumulator
): BotRunResult {
  const summary = summarize(state);
  const panicEvents = state.events.filter((event) => event.type === "panic").length;
  const strikeEvents = state.events.filter((event) => event.type === "strike").length;
  const lavatoryVisits = state.passengers.reduce(
    (total, passenger) => total + passenger.lavatoryVisitCount,
    0
  );
  const babyDiaperChanges = state.passengers.reduce(
    (total, passenger) => total + passenger.babyDiaperChangeCount,
    0
  );

  const meanConcurrentDemand =
    metrics.demandSamples === 0 ? 0 : metrics.demandTotal / metrics.demandSamples;
  const demandSpikiness =
    meanConcurrentDemand === 0 ? 0 : metrics.peakConcurrentDemand / meanConcurrentDemand;
  const lavatoryUtilization =
    metrics.totalLavatorySeconds === 0
      ? 0
      : metrics.occupiedLavatorySeconds / metrics.totalLavatorySeconds;
  const busyFraction =
    metrics.demandSamples === 0 ? 0 : metrics.busySamples / metrics.demandSamples;

  return {
    configId: config.id,
    configName: config.name,
    strategy: strategy.name,
    seed: config.seed,
    actionsPerMinute,
    durationSeconds: config.durationSeconds,
    finalTime: state.time,
    status: state.status,
    strikes: state.strikes,
    assignmentsMade: metrics.assignmentsMade,
    panicEvents,
    strikeEvents,
    lavatoryVisits,
    babyDiaperChanges,
    maxQueueLength: metrics.maxQueueLength,
    averageBladderPercent: summary.averageBladderPercent,
    peakConcurrentDemand: metrics.peakConcurrentDemand,
    meanConcurrentDemand,
    demandSpikiness,
    lavatoryUtilization,
    busyFraction
  };
}
