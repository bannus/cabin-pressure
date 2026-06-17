import { tinyReadableCabin } from "./config";
import { compareConfigs, defaultSeeds } from "./batch";
import type { BatchSummary, NamedConfig } from "./batch";
import type { LevelConfig } from "./types";

interface BotCliOptions {
  seeds: number;
  baseSeed: number;
  duration?: number;
  dt?: number;
}

function main(): void {
  const options = parseArgs(process.argv.slice(2));
  const seeds = defaultSeeds(options.seeds, options.baseSeed);

  const baseline: LevelConfig = applyOverrides(tinyReadableCabin, options);
  const singleLavatory: LevelConfig = {
    ...baseline,
    id: "single-lavatory-cabin",
    name: "Single Lavatory Cabin",
    aircraft: {
      ...baseline.aircraft,
      lavatories: baseline.aircraft.lavatories.slice(-1)
    }
  };

  const namedConfigs: NamedConfig[] = [
    { label: "baseline", config: baseline },
    { label: "single-lav", config: singleLavatory }
  ];

  console.log("Cabin Pressure milestone 9: automated bot runs");
  console.log(`Seeds: ${seeds.length} (base ${options.baseSeed})`);
  console.log(`Duration: ${baseline.durationSeconds}s`);
  console.log("");

  const comparison = compareConfigs(namedConfigs, { seeds, dt: options.dt });

  for (const { label, summary } of comparison) {
    printSummary(label, summary);
  }
}

function printSummary(label: string, summary: BatchSummary): void {
  console.log(`[${label}] ${summary.configName} (${summary.configId})`);
  console.log(
    `  runs=${summary.runCount} wins=${summary.wins} losses=${summary.losses} ` +
      `winRate=${(summary.winRate * 100).toFixed(1)}%`
  );
  console.log(
    `  avgStrikes=${summary.averageStrikes.toFixed(2)} ` +
      `avgAssignments=${summary.averageAssignments.toFixed(1)} ` +
      `avgPanic=${summary.averagePanicEvents.toFixed(2)}`
  );
  console.log(
    `  avgLavVisits=${summary.averageLavatoryVisits.toFixed(1)} ` +
      `maxQueue=${summary.maxQueueLength} ` +
      `avgBladder=${Math.round(summary.averageBladderPercent * 100)}%`
  );
  console.log("");
}

function applyOverrides(config: LevelConfig, options: BotCliOptions): LevelConfig {
  return {
    ...config,
    durationSeconds: options.duration ?? config.durationSeconds
  };
}

function parseArgs(args: string[]): BotCliOptions {
  const parsed: BotCliOptions = {
    seeds: 20,
    baseSeed: tinyReadableCabin.seed
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--seeds" && value !== undefined) {
      parsed.seeds = parsePositiveInteger(value, "--seeds");
      index += 1;
    } else if (arg === "--base-seed" && value !== undefined) {
      const baseSeed = parseFiniteNumber(value, "--base-seed");
      if (!Number.isInteger(baseSeed)) {
        throw new Error("--base-seed must be an integer");
      }
      parsed.baseSeed = baseSeed;
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
