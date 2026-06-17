import { withLevelOverrides } from "./config";
import { runBotSimulation } from "./bot";
import type { BotOptions, BotRunResult } from "./bot";
import type { LevelConfig } from "./types";

export interface BatchOptions extends BotOptions {
  seeds?: number[];
}

export interface BatchSummary {
  configId: string;
  configName: string;
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

export function defaultSeeds(count: number, baseSeed: number): number[] {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error("seed count must be a positive integer");
  }
  return Array.from({ length: count }, (_unused, index) => baseSeed + index);
}

export function runBatch(config: LevelConfig, options: BatchOptions = {}): BatchSummary {
  const seeds = options.seeds ?? defaultSeeds(20, config.seed);
  const runOptions: BotOptions = { dt: options.dt, startBeverageCart: options.startBeverageCart };

  const runs = seeds.map((seed) =>
    runBotSimulation(withLevelOverrides(config, { seed }), runOptions)
  );

  return summarizeRuns(config, runs);
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

function summarizeRuns(config: LevelConfig, runs: BotRunResult[]): BatchSummary {
  const runCount = runs.length;
  const wins = runs.filter((run) => run.status === "won").length;
  const losses = runs.filter((run) => run.status === "lost").length;
  const total = (selector: (run: BotRunResult) => number): number =>
    runs.reduce((sum, run) => sum + selector(run), 0);
  const average = (selector: (run: BotRunResult) => number): number =>
    runCount === 0 ? 0 : total(selector) / runCount;

  return {
    configId: config.id,
    configName: config.name,
    runCount,
    wins,
    losses,
    winRate: runCount === 0 ? 0 : wins / runCount,
    averageStrikes: average((run) => run.strikes),
    averageAssignments: average((run) => run.assignmentsMade),
    averagePanicEvents: average((run) => run.panicEvents),
    averageLavatoryVisits: average((run) => run.lavatoryVisits),
    maxQueueLength: runs.reduce((max, run) => Math.max(max, run.maxQueueLength), 0),
    averageBladderPercent: average((run) => run.averageBladderPercent),
    runs
  };
}
