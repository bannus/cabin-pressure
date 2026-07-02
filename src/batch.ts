import { withLevelOverrides } from "./config";
import { greedyStrategy, runBotSimulation } from "./bot";
import type { BotOptions, BotRunResult, BotStrategy } from "./bot";
import type { LevelConfig } from "./types";

export interface BatchOptions {
  seeds?: number[];
  dt?: number;
  strategy?: BotStrategy;
  startBeverageCart?: boolean;
  actionsPerMinute?: number;
}

export interface BatchSummary {
  configId: string;
  configName: string;
  strategy: string;
  actionsPerMinute: number;
  runCount: number;
  wins: number;
  losses: number;
  winRate: number;
  averageStrikes: number;
  averageAssignments: number;
  averagePanicEvents: number;
  averageLavatoryVisits: number;
  maxQueueLength: number;
  averageBladderPercent: number;
  averagePeakConcurrentDemand: number;
  averageDemandSpikiness: number;
  averageLavatoryUtilization: number;
  averageBusyFraction: number;
  strikeStdev: number;
  peakDemandStdev: number;
  runs: BotRunResult[];
}

export interface NamedConfig {
  label: string;
  config: LevelConfig;
}

export interface ComparisonResult {
  label: string;
  summary: BatchSummary;
}

export interface SweepCell {
  label: string;
  strategy: string;
  summary: BatchSummary;
}

export interface ApmSweepCell {
  actionsPerMinute: number;
  summary: BatchSummary;
}

export function defaultSeeds(count: number, baseSeed: number): number[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("seed count must be a positive integer");
  }
  if (!Number.isFinite(baseSeed) || !Number.isInteger(baseSeed)) {
    throw new Error("baseSeed must be a finite integer");
  }
  return Array.from({ length: count }, (_unused, index) => baseSeed + index);
}

export function runBatch(config: LevelConfig, options: BatchOptions = {}): BatchSummary {
  const seeds = options.seeds ?? defaultSeeds(20, config.seed);
  const strategy = options.strategy ?? greedyStrategy;
  const runOptions: BotOptions = {
    dt: options.dt,
    strategy,
    startBeverageCart: options.startBeverageCart,
    actionsPerMinute: options.actionsPerMinute
  };

  const runs = seeds.map((seed) =>
    runBotSimulation(withLevelOverrides(config, { seed }), runOptions)
  );

  return summarizeRuns(config, strategy, runs);
}

export function compareConfigs(
  namedConfigs: NamedConfig[],
  options: BatchOptions = {}
): ComparisonResult[] {
  return namedConfigs.map((named) => ({
    label: named.label,
    summary: runBatch(named.config, options)
  }));
}

export function sweepConfigs(
  namedConfigs: NamedConfig[],
  strategies: BotStrategy[],
  options: BatchOptions = {}
): SweepCell[] {
  const cells: SweepCell[] = [];
  for (const named of namedConfigs) {
    for (const strategy of strategies) {
      cells.push({
        label: named.label,
        strategy: strategy.name,
        summary: runBatch(named.config, { ...options, strategy })
      });
    }
  }
  return cells;
}

export function sweepActionsPerMinute(
  config: LevelConfig,
  apmValues: number[],
  options: BatchOptions = {}
): ApmSweepCell[] {
  return apmValues.map((actionsPerMinute) => ({
    actionsPerMinute,
    summary: runBatch(config, { ...options, actionsPerMinute })
  }));
}

function average(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function stdev(values: number[]): number {
  if (values.length === 0) {
    return 0;
  }
  const mean = average(values);
  const variance = average(values.map((value) => (value - mean) ** 2));
  return Math.sqrt(variance);
}

function summarizeRuns(
  config: LevelConfig,
  strategy: BotStrategy,
  runs: BotRunResult[]
): BatchSummary {
  const runCount = runs.length;
  const wins = runs.filter((run) => run.status === "won").length;
  const losses = runs.filter((run) => run.status === "lost").length;
  const select = (selector: (run: BotRunResult) => number): number[] => runs.map(selector);

  return {
    configId: config.id,
    configName: config.name,
    strategy: strategy.name,
    actionsPerMinute: runs[0]?.actionsPerMinute ?? Number.POSITIVE_INFINITY,
    runCount,
    wins,
    losses,
    winRate: runCount === 0 ? 0 : wins / runCount,
    averageStrikes: average(select((run) => run.strikes)),
    averageAssignments: average(select((run) => run.assignmentsMade)),
    averagePanicEvents: average(select((run) => run.panicEvents)),
    averageLavatoryVisits: average(select((run) => run.lavatoryVisits)),
    maxQueueLength: runs.reduce((max, run) => Math.max(max, run.maxQueueLength), 0),
    averageBladderPercent: average(select((run) => run.averageBladderPercent)),
    averagePeakConcurrentDemand: average(select((run) => run.peakConcurrentDemand)),
    averageDemandSpikiness: average(select((run) => run.demandSpikiness)),
    averageLavatoryUtilization: average(select((run) => run.lavatoryUtilization)),
    averageBusyFraction: average(select((run) => run.busyFraction)),
    strikeStdev: stdev(select((run) => run.strikes)),
    peakDemandStdev: stdev(select((run) => run.peakConcurrentDemand)),
    runs
  };
}
