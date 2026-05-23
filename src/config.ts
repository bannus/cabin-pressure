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
    initialFillRange: [0.05, 0.45],
    baseFillPerSecond: 100 / 220,
    requestThreshold: 0.7,
    desperateThreshold: 0.9
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
