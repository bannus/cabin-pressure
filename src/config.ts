import type { LevelConfig } from "./types";

export const tinyReadableCabin: LevelConfig = {
  id: "tiny-readable-cabin",
  name: "Tiny Readable Cabin",
  durationSeconds: 180,
  seed: 12345,
  aircraft: {
    rows: 8,
    seatLayout: ["A", "B", "C", "D"],
    lavatories: [
      { id: "front", row: 0 },
      { id: "rear", row: 9 }
    ]
  },
  passengerMix: {
    normal: 24,
    smallBladder: 4,
    bigBladder: 4
  },
  bladder: {
    initialFillRange: [0.0, 0.25],
    baseFillPerSecond: 100 / 350,
    requestThreshold: 0.7,
    desperateThreshold: 0.9
  },
  lavatory: {
    minimumWalkSeconds: 2,
    walkSecondsPerRow: 0.75,
    passingSlowdownMultiplier: 2,
    useDurationSeconds: [8, 14]
  },
  seatBlockers: {
    standSeconds: 1,
    sitSeconds: 1,
    standCooldownSeconds: 3
  },
  beverageCart: {
    serviceRows: [8, 7, 6, 5, 4, 3, 2, 1],
    rowServiceSeconds: [2, 3],
    moveSecondsPerRow: 1,
    bladderRateMultiplier: 1.35,
    bladderRateDelaySeconds: 20,
    bladderRateDurationSeconds: 45,
    autoStart: false
  },
  turbulence: {
    warningSeconds: 5,
    durationSeconds: [10, 16],
    seatBeltSignChance: 1,
    autoStartSeconds: 90
  },
  loss: {
    panicGraceSeconds: 8,
    maxStrikes: 3,
    strikeRecoveryFillPercent: 0.65
  }
};

export function withLevelOverrides(
  config: LevelConfig,
  overrides: Partial<Pick<LevelConfig, "seed" | "durationSeconds">>
): LevelConfig {
  return {
    ...config,
    seed: overrides.seed ?? config.seed,
    durationSeconds: overrides.durationSeconds ?? config.durationSeconds
  };
}
