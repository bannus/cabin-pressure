import { pressureFlight } from "./config";
import { defaultSeeds } from "./batch";
import { runTuningSimulation, tuningPolicies } from "./tuning";
import type { LevelConfig } from "./types";

const args = process.argv.slice(2);
let count = 50;
let baseSeed = 1;
let sweep = false;
let json = false;
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index];
  if (arg === "--sweep") {
    sweep = true;
  } else if (arg === "--json") {
    json = true;
  } else if (arg === "--seeds" || arg === "--base-seed") {
    const value = Number(args[++index]);
    if (!Number.isSafeInteger(value) || (arg === "--seeds" && value <= 0)) {
      throw new Error(`${arg} must be ${arg === "--seeds" ? "a positive" : "a safe"} integer`);
    }
    if (arg === "--seeds") count = value;
    else baseSeed = value;
  } else {
    throw new Error(`Unknown option: ${arg}`);
  }
}

const configs: LevelConfig[] = sweep ? [160, 180, 200].flatMap((fillSeconds) =>
  [8, 10, 12].map((minimumUse): LevelConfig => ({
    ...pressureFlight, id: `fill-${fillSeconds}-loo-${minimumUse}`,
    bladder: { ...pressureFlight.bladder, baseFillPerSecond: 100 / fillSeconds },
    lavatory: { ...pressureFlight.lavatory, useDurationSeconds: [minimumUse, minimumUse + 4] }
  }))) : [pressureFlight];

const rows = configs.flatMap((config) => tuningPolicies.map((policy) => {
  const runs = defaultSeeds(count, baseSeed).map((seed) => runTuningSimulation({ ...config, seed }, policy));
  const mean = (select: (run: typeof runs[number]) => number): number =>
    Number((runs.reduce((sum, run) => sum + select(run), 0) / count).toFixed(2));
  return {
    config: config.id, policy, runs: count, wins: runs.filter((run) => run.won).length,
    cleanWins: runs.filter((run) => run.won && run.strikes === 0).length,
    strikes: mean((run) => run.strikes), commands: mean((run) => run.commands),
    served: mean((run) => run.served), visits: mean((run) => run.visits),
    diapers: mean((run) => run.diapersChanged),
    serviceLosses: runs.filter((run) => run.failureReason === "service").length,
    firstDecision: mean((run) => run.firstDecisionSeconds ?? config.durationSeconds),
    maxQueue: Math.max(...runs.map((run) => run.maxQueue)),
    parkedSeconds: mean((run) => run.parkedSeconds),
    utilization30s: Array.from({ length: Math.ceil(config.durationSeconds / 30) }, (_, index) =>
      mean((run) => run.busySecondsByWindow[index] / (Math.min(30, config.durationSeconds - index * 30) * config.aircraft.lavatories.length)))
  };
}));
if (json) console.log(JSON.stringify({ baseSeed, decisionIntervalSeconds: 2, rows }, null, 2));
else {
  console.log(`The Drinks Run: ${count} seeds from ${baseSeed}; one command per 2s; 30s toilet utilization windows`);
  console.table(rows.map((row) => ({ ...row, utilization30s: row.utilization30s.join(" / ") })));
}
