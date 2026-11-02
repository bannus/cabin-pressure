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

export const pressureFlight: LevelConfig = {
  ...tinyReadableCabin,
  id: "the-drinks-run",
  name: "The Drinks Run",
  seed: 42,
  durationSeconds: 120,
  aircraft: {
    rows: 4,
    seatLayout: ["A", "B", "C", "D"],
    lavatories: [{ id: "front", row: 0 }, { id: "rear", row: 5 }]
  },
  passengerMix: { normal: 11, smallBladder: 3, bigBladder: 1, babyAttachedAdult: 1 },
  bladder: {
    initialFillRange: [0.15, 0.75],
    initialFillDistribution: [
      { weight: 5, range: [0.15, 0.4] },
      { weight: 3, range: [0.4, 0.65] },
      { weight: 2, range: [0.65, 0.78] }
    ],
    baseFillPerSecond: 100 / 180,
    requestThreshold: 0.65,
    desperateThreshold: 0.9
  },
  lavatory: {
    minimumWalkSeconds: 0.5,
    walkSecondsPerRow: 0.8,
    passingSlowdownMultiplier: 1.6,
    useDurationSeconds: [8, 12]
  },
  seatBlockers: { standSeconds: 0.7, sitSeconds: 0.7, standCooldownSeconds: 1.5 },
  beverageCart: {
    serviceRows: [4, 3, 2, 1],
    rowServiceSeconds: [17, 19],
    moveSecondsPerRow: 1,
    bladderRateMultiplier: 1.4,
    bladderRateDelaySeconds: 12,
    bladderRateDurationSeconds: 35,
    autoStart: true,
    requiredPassengersServed: 16,
    maneuverSeconds: 2
  },
  turbulence: {
    warningSeconds: 20,
    durationSeconds: [10, 10],
    seatBeltSignChance: 1,
    autoStartSeconds: 45
  },
  babyDiaper: {
    firstEventSeconds: [22, 32],
    repeatEventSeconds: [150, 150],
    changeDurationSeconds: [20, 24],
    patienceSeconds: 45
  },
  loss: { panicGraceSeconds: 8, maxStrikes: 3, strikeRecoveryFillPercent: 0.3 }
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
