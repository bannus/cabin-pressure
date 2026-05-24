import { ARCHETYPES } from "./archetypes";
import type { LevelConfig, PassengerArchetype } from "./types";

const ARCHETYPE_ORDER: PassengerArchetype[] = [
  "normal",
  "smallBladder",
  "bigBladder",
  "babyAttachedAdult"
];

export interface LavatoryDemandEstimate {
  expectedDemandSeconds: number;
  perfectUtilizationSupplySeconds: number;
  demandToSupplyRatio: number;
  expectedBladderVisits: number;
  expectedBabyDiaperVisits: number;
}

export function estimateLavatoryDemand(config: LevelConfig): LavatoryDemandEstimate {
  const seatCount = config.aircraft.rows * config.aircraft.seatLayout.length;
  const passengerCounts = buildPassengerCounts(config, seatCount);
  const averageInitialFill =
    (config.bladder.initialFillRange[0] + config.bladder.initialFillRange[1]) / 2;
  const averageLavatoryUseSeconds =
    (config.lavatory.useDurationSeconds[0] + config.lavatory.useDurationSeconds[1]) / 2;

  let expectedBladderVisits = 0;
  for (const archetype of ARCHETYPE_ORDER) {
    const passengerCount = passengerCounts[archetype];
    if (passengerCount <= 0) {
      continue;
    }

    const definition = ARCHETYPES[archetype];
    const fillPercentPerSecond =
      (config.bladder.baseFillPerSecond * definition.bladderRateMultiplier) / definition.capacity;
    const expectedVisitsPerPassenger = Math.max(
      0,
      (averageInitialFill + fillPercentPerSecond * config.durationSeconds - config.bladder.requestThreshold) /
        config.bladder.requestThreshold
    );
    expectedBladderVisits += passengerCount * expectedVisitsPerPassenger;
  }

  const babyPassengerCount = passengerCounts.babyAttachedAdult;
  const expectedBabyDiaperVisits = expectedBabyVisits(config, babyPassengerCount);

  const averageDiaperChangeSeconds =
    config.babyDiaper === undefined
      ? 0
      : (config.babyDiaper.changeDurationSeconds[0] + config.babyDiaper.changeDurationSeconds[1]) / 2;

  const expectedDemandSeconds =
    expectedBladderVisits * averageLavatoryUseSeconds +
    expectedBabyDiaperVisits * averageDiaperChangeSeconds;

  const perfectUtilizationSupplySeconds = config.durationSeconds * config.aircraft.lavatories.length;

  return {
    expectedDemandSeconds,
    perfectUtilizationSupplySeconds,
    demandToSupplyRatio:
      perfectUtilizationSupplySeconds <= 0 ? Number.POSITIVE_INFINITY : expectedDemandSeconds / perfectUtilizationSupplySeconds,
    expectedBladderVisits,
    expectedBabyDiaperVisits
  };
}

function buildPassengerCounts(config: LevelConfig, seatCount: number): Record<PassengerArchetype, number> {
  const counts: Record<PassengerArchetype, number> = {
    normal: 0,
    smallBladder: 0,
    bigBladder: 0,
    babyAttachedAdult: 0
  };

  let seatsRemaining = seatCount;
  for (const archetype of ARCHETYPE_ORDER) {
    const requested = Math.max(0, Math.ceil(config.passengerMix[archetype] ?? 0));
    const assigned = Math.min(seatsRemaining, requested);
    counts[archetype] = assigned;
    seatsRemaining -= assigned;
  }

  if (seatsRemaining > 0) {
    counts.normal += seatsRemaining;
  }

  return counts;
}

function expectedBabyVisits(config: LevelConfig, babyPassengerCount: number): number {
  if (config.babyDiaper === undefined || babyPassengerCount <= 0) {
    return 0;
  }

  const averageFirstSeconds =
    (config.babyDiaper.firstEventSeconds[0] + config.babyDiaper.firstEventSeconds[1]) / 2;
  const averageRepeatSeconds =
    (config.babyDiaper.repeatEventSeconds[0] + config.babyDiaper.repeatEventSeconds[1]) / 2;
  const repeatsPerPassenger = Math.max(0, (config.durationSeconds - averageFirstSeconds) / averageRepeatSeconds);
  return babyPassengerCount * (1 + repeatsPerPassenger);
}
