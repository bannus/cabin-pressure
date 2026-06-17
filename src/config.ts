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
    normal: 22,
    smallBladder: 4,
    bigBladder: 4,
    babyAttachedAdult: 2
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
  babyDiaper: {
    firstEventSeconds: [35, 75],
    repeatEventSeconds: [60, 100],
    changeDurationSeconds: [20, 30]
  },
  loss: {
    panicGraceSeconds: 8,
    maxStrikes: 3,
    strikeRecoveryFillPercent: 0.65
  }
};

export const mediumCabin: LevelConfig = {
  id: "medium-cabin",
  name: "Medium Cabin",
  durationSeconds: 300,
  seed: 24680,
  aircraft: {
    rows: 30,
    seatLayout: ["A", "B", "C", "D", "E", "F"],
    lavatories: [
      { id: "front", row: 0 },
      { id: "rearA", row: 31 },
      { id: "rearB", row: 31 }
    ]
  },
  passengerMix: {
    normal: 150,
    smallBladder: 14,
    bigBladder: 12,
    babyAttachedAdult: 4
  },
  bladder: {
    initialFillRange: [0.0, 0.3],
    baseFillPerSecond: 100 / 500,
    requestThreshold: 0.7,
    desperateThreshold: 0.9
  },
  lavatory: {
    minimumWalkSeconds: 2,
    walkSecondsPerRow: 0.75,
    passingSlowdownMultiplier: 2,
    useDurationSeconds: [6, 11]
  },
  seatBlockers: {
    standSeconds: 1,
    sitSeconds: 1,
    standCooldownSeconds: 3
  },
  beverageCart: {
    serviceRows: [30, 29, 28, 27, 26, 25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1],
    rowServiceSeconds: [2, 3],
    moveSecondsPerRow: 1,
    bladderRateMultiplier: 1.35,
    bladderRateDelaySeconds: 20,
    bladderRateDurationSeconds: 45,
    autoStart: false
  },
  turbulence: {
    warningSeconds: 5,
    durationSeconds: [12, 20],
    seatBeltSignChance: 0.5,
    autoStartSeconds: 150
  },
  babyDiaper: {
    firstEventSeconds: [35, 75],
    repeatEventSeconds: [60, 100],
    changeDurationSeconds: [20, 30]
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
