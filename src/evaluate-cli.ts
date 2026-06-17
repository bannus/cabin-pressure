import { mediumCabin } from "./config";
import {
  fixedLavatoryStrategy,
  greedyStrategy,
  panicStrategy
} from "./bot";
import type { BotStrategy } from "./bot";
import { defaultSeeds, runBatch, sweepConfigs } from "./batch";
import type { BatchOptions, BatchSummary, NamedConfig } from "./batch";
import type { LavatoryConfig, LevelConfig } from "./types";

interface EvaluateCliOptions {
  seeds: number;
  baseSeed: number;
  duration?: number;
  dt?: number;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const seeds = defaultSeeds(options.seeds, options.baseSeed);
  const baseline = applyOverrides(mediumCabin, options);
  const batchOptions: BatchOptions = {
    seeds,
    dt: options.dt ?? 0.2,
    startBeverageCart: true
  };

  console.log("Cabin Pressure milestone 10: fun evaluation harness");
  console.log(`Config: ${baseline.name} (${baseline.id})`);
  console.log(
    `Passengers: ${countSeats(baseline)} seats / ` +
      `${baseline.aircraft.lavatories.length} lavatories · duration ${baseline.durationSeconds}s`
  );
  console.log(`Seeds: ${seeds.length} (base ${options.baseSeed}) · dt ${batchOptions.dt}`);
  console.log("");

  const greedySummary = reportStrategyDepth(baseline, batchOptions);
  reportFunMetrics(greedySummary);
  reportDifficultySweep(baseline, batchOptions);
}

function reportStrategyDepth(config: LevelConfig, options: BatchOptions): BatchSummary {
  console.log("== Decision depth (skill gap between strategies) ==");
  const strategies: BotStrategy[] = [greedyStrategy, panicStrategy, fixedLavatoryStrategy];
  const summaries = strategies.map((strategy) => runBatch(config, { ...options, strategy }));

  for (const summary of summaries) {
    console.log(
      `  ${summary.strategy.padEnd(15)} winRate=${formatPercent(summary.winRate)} ` +
        `avgStrikes=${summary.averageStrikes.toFixed(2)} ` +
        `lavUtil=${formatPercent(summary.averageLavatoryUtilization)}`
    );
  }

  const best = summaries[0].winRate;
  const worst = summaries[summaries.length - 1].winRate;
  console.log(`  -> skill gap (greedy - fixed): ${formatPercent(best - worst)}`);
  console.log(`     ${interpretSkillGap(best, worst)}`);
  console.log("");
  return summaries[0];
}

function reportFunMetrics(summary: BatchSummary): void {
  console.log("== Fun metrics (greedy bot) ==");
  console.log(
    `  winRate=${formatPercent(summary.winRate)} ` +
      `lavUtilization=${formatPercent(summary.averageLavatoryUtilization)} ` +
      `busyFraction=${formatPercent(summary.averageBusyFraction)}`
  );
  console.log(
    `  peakConcurrentDemand=${summary.averagePeakConcurrentDemand.toFixed(1)} ` +
      `spikiness=${summary.averageDemandSpikiness.toFixed(2)} ` +
      `maxQueue=${summary.maxQueueLength}`
  );
  console.log(
    `  repetitiveness: strikeStdev=${summary.strikeStdev.toFixed(2)} ` +
      `peakDemandStdev=${summary.peakDemandStdev.toFixed(2)} (higher = more varied)`
  );
  console.log(`  -> ${interpretFun(summary)}`);
  console.log("");
}

function reportDifficultySweep(config: LevelConfig, options: BatchOptions): void {
  console.log("== Difficulty sweep (lavatory supply x strategy) ==");
  const variants: NamedConfig[] = [2, 3, 4].map((count) => ({
    label: `${count}-lav`,
    config: withLavatoryCount(config, count)
  }));
  const strategies: BotStrategy[] = [greedyStrategy, panicStrategy];

  const cells = sweepConfigs(variants, strategies, options);
  for (const cell of cells) {
    console.log(
      `  ${cell.label.padEnd(7)} ${cell.strategy.padEnd(8)} ` +
        `winRate=${formatPercent(cell.summary.winRate)} ` +
        `avgStrikes=${cell.summary.averageStrikes.toFixed(2)} ` +
        `lavUtil=${formatPercent(cell.summary.averageLavatoryUtilization)}`
    );
  }
  console.log("  -> aim for a variant where greedy wins ~60-80% and clearly beats panic.");
  console.log("");
}

function withLavatoryCount(config: LevelConfig, count: number): LevelConfig {
  const rearRow = config.aircraft.rows + 1;
  const midRow = Math.round(config.aircraft.rows / 2);
  const pool: LavatoryConfig[] = [
    { id: "front", row: 0 },
    { id: "rearA", row: rearRow },
    { id: "rearB", row: rearRow },
    { id: "mid", row: midRow }
  ];
  const order = [pool[0], pool[1], pool[2], pool[3]];
  return {
    ...config,
    aircraft: {
      ...config.aircraft,
      lavatories: order.slice(0, count)
    }
  };
}

function interpretSkillGap(best: number, worst: number): number | string {
  const gap = best - worst;
  if (gap < 0.15) {
    return "low skill gap: assignment decisions barely matter (risk: not engaging).";
  }
  if (gap > 0.6) {
    return "high skill gap: smart play is essential (good for depth).";
  }
  return "moderate skill gap: decisions matter without being punishing.";
}

function interpretFun(summary: BatchSummary): string {
  if (summary.winRate >= 0.95) {
    return "likely too easy for the greedy bot (little failure pressure).";
  }
  if (summary.winRate <= 0.2) {
    return "likely too hard even with good play.";
  }
  if (summary.averageLavatoryUtilization < 0.4) {
    return "low lavatory utilization: probably under-stressed (boring).";
  }
  return "in the hectic-but-fair band: busy lavatories with real failure risk.";
}

function applyOverrides(config: LevelConfig, options: EvaluateCliOptions): LevelConfig {
  return {
    ...config,
    durationSeconds: options.duration ?? config.durationSeconds
  };
}

function countSeats(config: LevelConfig): number {
  return config.aircraft.rows * config.aircraft.seatLayout.length;
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function parseArgs(args: string[]): EvaluateCliOptions {
  const parsed: EvaluateCliOptions = {
    seeds: 10,
    baseSeed: mediumCabin.seed
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--seeds" && value !== undefined) {
      parsed.seeds = parsePositiveInteger(value, "--seeds");
      index += 1;
    } else if (arg === "--base-seed" && value !== undefined) {
      parsed.baseSeed = parseFiniteNumber(value, "--base-seed");
      index += 1;
    } else if (arg === "--duration" && value !== undefined) {
      parsed.duration = parsePositiveFiniteNumber(value, "--duration");
      index += 1;
    } else if (arg === "--dt" && value !== undefined) {
      parsed.dt = parsePositiveFiniteNumber(value, "--dt");
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }

  return parsed;
}

function parseFiniteNumber(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a finite number`);
  }
  return parsed;
}

function parsePositiveFiniteNumber(value: string, optionName: string): number {
  const parsed = parseFiniteNumber(value, optionName);
  if (parsed <= 0) {
    throw new Error(`${optionName} must be positive`);
  }
  return parsed;
}

function parsePositiveInteger(value: string, optionName: string): number {
  const parsed = parsePositiveFiniteNumber(value, optionName);
  if (!Number.isInteger(parsed)) {
    throw new Error(`${optionName} must be a positive integer`);
  }
  return parsed;
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
}
