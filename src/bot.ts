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
  SimulationState,
  SimulationStatus
} from "./types";

export interface BotOptions {
  dt?: number;
  startBeverageCart?: boolean;
}

export interface BotRunResult {
  configId: string;
  configName: string;
  seed: number;
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
}

const DEFAULT_DT = 0.1;

export function urgencyScore(passenger: Passenger): number {
  return (
    bladderPercent(passenger) * 100 +
    (passenger.state === "Panic" ? 50 : 0) +
    (passenger.babyDiaperNeedsChange ? 35 : 0) +
    (passenger.state === "NeedsToGo" ? 15 : 0)
  );
}

function needsAssignment(passenger: Passenger): boolean {
  return (
    passenger.assignedLavatoryId === undefined &&
    (passenger.state === "NeedsToGo" || passenger.state === "Panic")
  );
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

export function botStep(state: SimulationState): number {
  if (state.status !== "running") {
    return 0;
  }

  const candidates = state.passengers
    .filter(needsAssignment)
    .sort((left, right) => {
      const delta = urgencyScore(right) - urgencyScore(left);
      if (delta !== 0) {
        return delta;
      }
      return left.id.localeCompare(right.id);
    });

  if (candidates.length === 0) {
    return 0;
  }

  const tentative = new Map<string, number>();
  let assignmentsMade = 0;

  for (const passenger of candidates) {
    const lavatory = chooseLavatory(state, passenger, tentative);
    try {
      assignPassengerToLavatory(state, passenger.id, lavatory.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("seat belt sign")) {
        return assignmentsMade;
      }
      continue;
    }
    tentative.set(lavatory.id, (tentative.get(lavatory.id) ?? 0) + 1);
    assignmentsMade += 1;
  }

  return assignmentsMade;
}

export function runBotSimulation(config: LevelConfig, options: BotOptions = {}): BotRunResult {
  const dt = options.dt ?? DEFAULT_DT;
  const state = createInitialState(config);

  if (options.startBeverageCart && state.beverageCart !== undefined) {
    startBeverageCart(state);
  }

  let assignmentsMade = 0;
  let maxQueueLength = 0;

  while (state.status === "running") {
    assignmentsMade += botStep(state);

    for (const lavatory of state.lavatories) {
      if (lavatory.queue.length > maxQueueLength) {
        maxQueueLength = lavatory.queue.length;
      }
    }

    tick(state, dt);
  }

  return buildResult(config, state, assignmentsMade, maxQueueLength);
}

function buildResult(
  config: LevelConfig,
  state: SimulationState,
  assignmentsMade: number,
  maxQueueLength: number
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

  return {
    configId: config.id,
    configName: config.name,
    seed: config.seed,
    durationSeconds: config.durationSeconds,
    finalTime: state.time,
    status: state.status,
    strikes: state.strikes,
    assignmentsMade,
    panicEvents,
    strikeEvents,
    lavatoryVisits,
    babyDiaperChanges,
    maxQueueLength,
    averageBladderPercent: summary.averageBladderPercent
  };
}
