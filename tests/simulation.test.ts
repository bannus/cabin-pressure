import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tinyReadableCabin, mediumCabin } from "../src/config";
import { estimateLavatoryDemand } from "../src/level-metrics";
import {
  runBotSimulation,
  botStep,
  greedyStrategy,
  panicStrategy,
  fixedLavatoryStrategy,
  flowControlStrategy
} from "../src/bot";
import { compareConfigs, defaultSeeds, runBatch, sweepConfigs, sweepActionsPerMinute } from "../src/batch";
import {
  assignPassengerToLavatory,
  createInitialState,
  runSimulation,
  startBeverageCart,
  startTurbulence,
  summarize,
  tick
} from "../src/simulation";
import type { LevelConfig } from "../src/types";

const instantSeatBlockers = {
  standSeconds: 0,
  sitSeconds: 0,
  standCooldownSeconds: 0
};

test("lavatory demand helper returns stable ratio for test level", () => {
  const estimate = estimateLavatoryDemand(tinyReadableCabin);

  assert.equal(Number(estimate.expectedDemandSeconds.toFixed(2)), 143.7);
  assert.equal(estimate.perfectUtilizationSupplySeconds, 360);
  assert.equal(Number(estimate.demandToSupplyRatio.toFixed(3)), 0.399);
  assert.equal(Number(estimate.expectedBladderVisits.toFixed(4)), 1.4163);
  assert.equal(Number(estimate.expectedBabyDiaperVisits.toFixed(3)), 5.125);
});

test("passenger generation is deterministic for the same seed", () => {
  const first = createInitialState(tinyReadableCabin);
  const second = createInitialState(tinyReadableCabin);

  assert.deepEqual(
    first.passengers.map((passenger) => ({
      id: passenger.id,
      row: passenger.row,
      seat: passenger.seat,
      archetype: passenger.archetype,
      rawBladder: Number(passenger.rawBladder.toFixed(6))
    })),
    second.passengers.map((passenger) => ({
      id: passenger.id,
      row: passenger.row,
      seat: passenger.seat,
      archetype: passenger.archetype,
      rawBladder: Number(passenger.rawBladder.toFixed(6))
    }))
  );
});

test("invalid level tuning fails fast", () => {
  assert.throws(
    () =>
      createInitialState({
        ...tinyReadableCabin,
        bladder: {
          ...tinyReadableCabin.bladder,
          requestThreshold: 1.1
        }
      }),
    /bladder thresholds must be between 0 and 1/
  );
  assert.throws(
    () =>
      createInitialState({
        ...tinyReadableCabin,
        bladder: {
          ...tinyReadableCabin.bladder,
          requestThreshold: 0.95,
          desperateThreshold: 0.9
        }
      }),
    /bladder\.requestThreshold must be <= desperateThreshold/
  );
  assert.throws(
    () =>
      createInitialState({
        ...tinyReadableCabin,
        loss: {
          ...tinyReadableCabin.loss,
          strikeRecoveryFillPercent: -0.1
        }
      }),
    /loss\.strikeRecoveryFillPercent must be between 0 and 1/
  );
});

test("unattended low-pressure flight can win at landing", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 5,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.05, 0.05],
      baseFillPerSecond: 0
    }
  };

  const result = runSimulation(config);

  assert.equal(result.status, "won");
  assert.equal(result.strikes, 0);
  assert.equal(result.events.at(-1)?.type, "win");
});

test("tick only advances systems by remaining time before landing", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 1,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0, 0],
      baseFillPerSecond: 50
    },
    loss: {
      ...tinyReadableCabin.loss,
      panicGraceSeconds: 1,
      maxStrikes: 1
    }
  };
  const state = createInitialState(config);

  tick(state, 1000);

  assert.equal(state.status, "won");
  assert.equal(state.strikes, 0);
  assert.equal(state.time, 1);
});

test("panic grace produces strikes and loss", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [1, 1],
      baseFillPerSecond: 0
    },
    loss: {
      panicGraceSeconds: 0.5,
      maxStrikes: 2,
      strikeRecoveryFillPercent: 1
    }
  };

  const result = runSimulation(config);

  assert.equal(result.status, "lost");
  assert.equal(result.strikes, 2);
  assert.equal(result.events.filter((event) => event.type === "strike").length, 2);
  assert.equal(result.events.at(-1)?.type, "loss");
});

test("panic grace includes the tick that enters panic", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.99, 0.99],
      baseFillPerSecond: 4
    },
    loss: {
      panicGraceSeconds: 0.5,
      maxStrikes: 1,
      strikeRecoveryFillPercent: 0.65
    }
  };

  const state = createInitialState(config);

  tick(state, 0.25);
  assert.equal(state.passengers[0]?.state, "Panic");
  assert.equal(state.passengers[0]?.panicSeconds, 0.25);
  assert.equal(state.strikes, 0);

  tick(state, 0.25);
  assert.equal(state.status, "lost");
  assert.equal(state.strikes, 1);
  assert.equal(state.events.filter((event) => event.type === "strike").length, 1);
});

test("assigned passenger walks to lavatory, uses it, and returns to seat", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 1,
      walkSecondsPerRow: 0,
      useDurationSeconds: [2, 2]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assert.equal(state.passengers[0]?.state, "WalkingToLavatory");

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "UsingLavatory");
  assert.equal(state.lavatories[0]?.occupantPassengerId, "P001");

  tick(state, 2);
  assert.equal(state.passengers[0]?.state, "ReturningToSeat");
  assert.equal(state.passengers[0]?.rawBladder, 0);

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "Seated");
  assert.equal(state.passengers[0]?.assignedLavatoryId, undefined);
  assert.deepEqual(
    state.events.map((event) => event.type),
    ["lavatoryAssigned", "lavatoryEntered", "lavatoryComplete", "returned"]
  );
});

test("lavatory assignments queue and can reroute before use", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A", "B"],
      lavatories: [
        { id: "front", row: 1 },
        { id: "rear", row: 1 }
      ]
    },
    passengerMix: { normal: 2 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 1,
      walkSecondsPerRow: 0,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assignPassengerToLavatory(state, "P002", "front");
  tick(state, 1);

  assert.equal(state.passengers[0]?.state, "UsingLavatory");
  assert.equal(state.passengers[1]?.state, "QueuedForLavatory");
  assert.deepEqual(state.lavatories[0]?.queue, ["P002"]);

  assignPassengerToLavatory(state, "P002", "rear");
  assert.deepEqual(state.lavatories[0]?.queue, []);

  tick(state, 1);
  assert.equal(state.passengers[1]?.state, "UsingLavatory");
  assert.equal(state.lavatories[1]?.occupantPassengerId, "P002");
  assert.equal(state.events.at(-2)?.type, "lavatoryRerouted");
});

test("assigned passenger moves through physical aisle cells", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 3,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 3 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 1,
      passingSlowdownMultiplier: 1,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P003", "front");
  assert.equal(state.passengers[2]?.aisleRow, 3);
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 3)?.passengerIds, ["P003"]);

  tick(state, 1);
  assert.equal(state.passengers[2]?.state, "WalkingToLavatory");
  assert.equal(state.passengers[2]?.aisleRow, 2);

  tick(state, 1);
  assert.equal(state.passengers[2]?.aisleRow, 1);

  tick(state, 1);
  assert.equal(state.passengers[2]?.state, "UsingLavatory");
  assert.equal(state.lavatories[0]?.occupantPassengerId, "P003");
});

test("lavatory queues expose physical queue positions", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 3,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 4 }]
    },
    passengerMix: { normal: 3 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 0,
      passingSlowdownMultiplier: 1,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assignPassengerToLavatory(state, "P002", "front");
  assignPassengerToLavatory(state, "P003", "front");
  for (let step = 0; step < 4; step += 1) {
    tick(state, 1);
  }

  // The aisle is single file, so the passenger physically nearest the lavatory
  // (P003 in row 3) reaches it first and the others line up behind in physical
  // order — assignment order does not let anyone overtake.
  assert.equal(state.passengers[2]?.state, "UsingLavatory");
  assert.equal(state.passengers[1]?.state, "QueuedForLavatory");
  assert.equal(state.passengers[1]?.queuePosition, 1);
  assert.equal(state.passengers[1]?.aisleRow, 3);
  assert.equal(state.passengers[0]?.state, "QueuedForLavatory");
  assert.equal(state.passengers[0]?.queuePosition, 2);
  assert.equal(state.passengers[0]?.aisleRow, 2);
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 3)?.passengerIds, ["P002"]);
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 2)?.passengerIds, ["P001"]);
});

test("passing conflicts slow aisle movement", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 2,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 2 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 1,
      passingSlowdownMultiplier: 3,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);
  state.passengers[0]!.state = "QueuedForLavatory";
  state.passengers[0]!.aisleRow = 1;
  state.passengers[0]!.queuePosition = 1;

  assignPassengerToLavatory(state, "P002", "front");

  assert.equal(state.passengers[1]?.aisleRow, 2);
  assert.equal(state.passengers[1]?.movementStepSecondsRemaining, 3);
});

test("single file aisle: a follower cannot overtake a same-direction walker", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 4,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 2 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 1,
      passingSlowdownMultiplier: 3.5,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  // Leader (P001) is one row ahead of the follower (P002); both walk toward the
  // front lavatory (row 0), i.e. the same direction.
  const leader = state.passengers[0]!;
  const follower = state.passengers[1]!;
  leader.state = "WalkingToLavatory";
  leader.assignedLavatoryId = "front";
  leader.aisleRow = 1;
  leader.destinationAisleRow = 0;
  leader.movementStepSecondsRemaining = 1;
  follower.state = "WalkingToLavatory";
  follower.assignedLavatoryId = "front";
  follower.aisleRow = 2;
  follower.destinationAisleRow = 0;
  follower.movementStepSecondsRemaining = 0;

  // The follower's next cell (row 1) is occupied by the same-direction leader, so
  // the follower is blocked and makes no progress while the leader is ahead of it.
  tick(state, 0.5);
  assert.equal(follower.aisleRow, 2);
  assert.equal(follower.state, "WalkingToLavatory");

  // Once the leader has cleared the aisle into the lavatory, the follower advances.
  for (let step = 0; step < 4; step += 1) {
    tick(state, 1);
  }
  assert.ok(follower.aisleRow! < 2 || follower.state !== "WalkingToLavatory");
});

test("desperate passengers keep walking to a lavatory and can still strike", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.99, 0.99],
      baseFillPerSecond: 4
    },
    lavatory: {
      minimumWalkSeconds: 5,
      walkSecondsPerRow: 0,
      useDurationSeconds: [2, 2]
    },
    seatBlockers: instantSeatBlockers,
    loss: {
      panicGraceSeconds: 1,
      maxStrikes: 5,
      strikeRecoveryFillPercent: 0.65
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.25);

  // A desperate passenger keeps their trip instead of abandoning it.
  assert.equal(state.passengers[0]?.state, "WalkingToLavatory");
  assert.equal(state.passengers[0]?.assignedLavatoryId, "front");
  assert.equal(state.passengers[0]?.panicSeconds, 0.25);

  // The five-second walk cannot finish before the one-second grace, so a strike
  // fires while the passenger is still in transit.
  tick(state, 1);

  assert.equal(state.passengers[0]?.strikeCount, 1);
  assert.equal(state.passengers[0]?.assignedLavatoryId, undefined);
  assert.equal(state.lavatories[0]?.queue.includes("P001"), false);
});

test("desperate passengers keep their place in the lavatory queue", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A", "B", "C", "D"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { normal: 4 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.99, 0.99],
      baseFillPerSecond: 4
    },
    lavatory: {
      minimumWalkSeconds: 1,
      walkSecondsPerRow: 0,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers,
    loss: {
      ...tinyReadableCabin.loss,
      panicGraceSeconds: 8
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assignPassengerToLavatory(state, "P002", "front");
  tick(state, 1);

  // The queued passenger is desperate but keeps their assignment and queue spot
  // rather than abandoning it.
  assert.equal(state.passengers[1]?.state, "QueuedForLavatory");
  assert.equal(state.passengers[1]?.assignedLavatoryId, "front");
  assert.deepEqual(state.lavatories[0]?.queue, ["P002"]);
  assert.ok((state.passengers[1]?.panicSeconds ?? 0) > 0);
});

test("inner-seat passengers require blockers to stand before exiting", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A", "B", "C", "D"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 4 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 0,
      useDurationSeconds: [1, 1]
    },
    seatBlockers: {
      standSeconds: 1,
      sitSeconds: 1,
      standCooldownSeconds: 2
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");

  assert.equal(state.passengers[0]?.state, "Standing");
  assert.equal(state.passengers[1]?.state, "Standing");
  assert.equal(state.passengers[1]?.blockingPassengerId, "P001");
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 1)?.passengerIds, [
    "P001",
    "P002"
  ]);

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "UsingLavatory");
  assert.equal(state.passengers[1]?.state, "Standing");

  tick(state, 1);
  assert.equal(state.passengers[1]?.state, "Sitting");

  tick(state, 1);
  assert.equal(state.passengers[1]?.state, "NeedsToGo");
  assert.equal(state.passengers[1]?.standCooldownSecondsRemaining, 2);
});

test("seat blocker cooldown delays a blocked passenger before standing", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A", "B", "C", "D"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 4 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 0,
      useDurationSeconds: [1, 1]
    },
    seatBlockers: {
      standSeconds: 1,
      sitSeconds: 1,
      standCooldownSeconds: 2
    }
  };
  const state = createInitialState(config);
  state.passengers[1]!.standCooldownSecondsRemaining = 1;

  assignPassengerToLavatory(state, "P001", "front");
  assert.equal(state.passengers[0]?.state, "WaitingForSeatBlockers");

  tick(state, 0.5);
  assert.equal(state.passengers[0]?.state, "WaitingForSeatBlockers");

  tick(state, 0.5);
  assert.equal(state.passengers[0]?.state, "Standing");
  assert.equal(state.passengers[1]?.state, "Standing");
});

test("returning passengers sit down before becoming seated", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 0,
      useDurationSeconds: [1, 1]
    },
    seatBlockers: {
      standSeconds: 0,
      sitSeconds: 1,
      standCooldownSeconds: 0
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "UsingLavatory");

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "ReturningToSeat");

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "Sitting");
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 1)?.passengerIds, ["P001"]);

  tick(state, 1);
  assert.equal(state.passengers[0]?.state, "Seated");
  assert.equal(state.passengers[0]?.aisleRow, undefined);
});

test("beverage cart starts on trigger and services rows in order", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 3,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 3 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.1, 0.1],
      baseFillPerSecond: 0
    },
    beverageCart: {
      serviceRows: [1, 3],
      rowServiceSeconds: [1, 1],
      moveSecondsPerRow: 1,
      bladderRateMultiplier: 2,
      bladderRateDelaySeconds: 5,
      bladderRateDurationSeconds: 10
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  assert.equal(state.beverageCart?.state, "ready");
  startBeverageCart(state);
  assert.equal(state.beverageCart?.state, "servicing");
  assert.equal(state.aisleCells.find((cell) => cell.row === 1)?.beverageCartId, "beverage-cart");

  tick(state, 1);
  assert.equal(state.beverageCart?.state, "moving");
  assert.equal(state.passengers[0]?.beverageRateModifierStartSeconds, 6);

  tick(state, 2);
  assert.equal(state.beverageCart?.state, "servicing");
  assert.equal(state.beverageCart?.currentAisleRow, 3);

  tick(state, 1);
  assert.equal(state.beverageCart?.state, "complete");
  assert.deepEqual(state.beverageCart?.passengerIdsServed, ["P001", "P003"]);
  startBeverageCart(state);
  assert.equal(state.beverageCart?.state, "servicing");
  assert.equal(state.beverageCart?.currentAisleRow, 1);
  assert.deepEqual(state.beverageCart?.passengerIdsServed, []);
  assert.deepEqual(
    state.events
      .filter((event) => event.type.startsWith("beverageCart"))
      .map((event) => event.type),
    [
      "beverageCartStarted",
      "beverageCartArrived",
      "beverageCartServiced",
      "beverageCartDeparted",
      "beverageCartArrived",
      "beverageCartServiced",
      "beverageCartComplete",
      "beverageCartStarted",
      "beverageCartArrived"
    ]
  );
});

test("beverage service applies a delayed bladder rate modifier window", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 20,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0, 0],
      baseFillPerSecond: 1
    },
    beverageCart: {
      serviceRows: [1],
      rowServiceSeconds: [1, 1],
      moveSecondsPerRow: 0,
      bladderRateMultiplier: 3,
      bladderRateDelaySeconds: 2,
      bladderRateDurationSeconds: 3
    },
    seatBlockers: instantSeatBlockers,
    loss: {
      ...tinyReadableCabin.loss,
      panicGraceSeconds: 100
    }
  };
  const state = createInitialState(config);

  startBeverageCart(state);
  tick(state, 1);
  tick(state, 1);
  assert.equal(state.passengers[0]?.beverageRateMultiplier, 1);
  assert.equal(state.passengers[0]?.rawBladder, 2);

  tick(state, 1);
  assert.equal(state.passengers[0]?.beverageRateMultiplier, 3);
  assert.equal(state.passengers[0]?.rawBladder, 5);

  tick(state, 1);
  tick(state, 1);
  tick(state, 1);
  assert.equal(state.passengers[0]?.beverageRateMultiplier, 1);
  assert.equal(state.passengers[0]?.rawBladder, 12);
});

test("active beverage cart occupies aisle cells and blocks passenger movement", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 2,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 2 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 1,
      passingSlowdownMultiplier: 4,
      useDurationSeconds: [5, 5]
    },
    beverageCart: {
      serviceRows: [1],
      rowServiceSeconds: [5, 5],
      moveSecondsPerRow: 1,
      bladderRateMultiplier: 2,
      bladderRateDelaySeconds: 0,
      bladderRateDurationSeconds: 1
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  startBeverageCart(state);
  assignPassengerToLavatory(state, "P002", "front");

  assert.equal(state.aisleCells.find((cell) => cell.row === 1)?.beverageCartId, "beverage-cart");
  assert.equal(state.passengers[1]?.movementStepSecondsRemaining, 0);

  tick(state, 1);
  assert.equal(state.passengers[1]?.aisleRow, 2);
});

test("turbulence warning can turn on seat belt sign and force aisle passengers to return", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 3,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 3 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.8, 0.8],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 5,
      passingSlowdownMultiplier: 1,
      useDurationSeconds: [5, 5]
    },
    seatBlockers: instantSeatBlockers,
    turbulence: {
      warningSeconds: 1,
      durationSeconds: [2, 2],
      seatBeltSignChance: 1
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P003", "front");
  tick(state, 5);
  assert.equal(state.passengers[2]?.aisleRow, 2);

  startTurbulence(state);
  assert.equal(state.turbulence?.phase, "warning");

  tick(state, 1);
  assert.equal(state.turbulence?.phase, "active");
  assert.equal(state.passengers[2]?.state, "ReturningToSeat");
  assert.equal(state.passengers[2]?.assignedLavatoryId, undefined);
  assert.equal(state.events.at(-1)?.type, "forcedReturn");
  assert.throws(
    () => assignPassengerToLavatory(state, "P001", "front"),
    /seat belt sign is on/
  );

  tick(state, 2);
  assert.equal(state.turbulence?.phase, "idle");
  assignPassengerToLavatory(state, "P001", "front");
  assert.equal(state.passengers[0]?.assignedLavatoryId, "front");
});

test("turbulence warning can pass without turning on the seat belt sign", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 1 },
    turbulence: {
      warningSeconds: 1,
      durationSeconds: [2, 2],
      seatBeltSignChance: 0
    }
  };
  const state = createInitialState(config);

  startTurbulence(state);
  tick(state, 1);

  assert.equal(state.turbulence?.phase, "idle");
  assert.equal(state.events.at(-1)?.type, "seatBeltSignSkipped");
  assignPassengerToLavatory(state, "P001", "front");
  assert.equal(state.passengers[0]?.assignedLavatoryId, "front");
});

test("baby-attached adults get diaper events with long lavatory tasks", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 60,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { babyAttachedAdult: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0, 0],
      baseFillPerSecond: 0
    },
    lavatory: {
      minimumWalkSeconds: 0,
      walkSecondsPerRow: 0,
      useDurationSeconds: [2, 2]
    },
    babyDiaper: {
      firstEventSeconds: [1, 1],
      repeatEventSeconds: [20, 20],
      changeDurationSeconds: [7, 7]
    },
    seatBlockers: instantSeatBlockers
  };
  const state = createInitialState(config);

  tick(state, 1);
  assert.equal(state.passengers[0]?.babyDiaperNeedsChange, true);
  assert.equal(state.passengers[0]?.state, "NeedsToGo");
  assert.equal(state.events.at(-1)?.type, "babyDiaperNeeded");

  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.1);
  assert.equal(state.passengers[0]?.state, "UsingLavatory");
  assert.equal(state.passengers[0]?.lavatorySecondsRemaining, 7);

  tick(state, 7);
  assert.equal(state.passengers[0]?.babyDiaperNeedsChange, false);
  assert.equal(state.passengers[0]?.babyDiaperChangeCount, 1);
  assert.equal(state.passengers[0]?.babyDiaperSecondsRemaining, 20);
  assert.deepEqual(
    state.events
      .filter((event) => event.type === "babyDiaperNeeded" || event.type === "babyDiaperChanged")
      .map((event) => event.type),
    ["babyDiaperNeeded", "babyDiaperChanged"]
  );
});

test("baby diaper indicators are exposed in urgency summaries", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { babyAttachedAdult: 1 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0, 0],
      baseFillPerSecond: 0
    },
    babyDiaper: {
      firstEventSeconds: [1, 1],
      repeatEventSeconds: [20, 20],
      changeDurationSeconds: [7, 7]
    }
  };
  const state = createInitialState(config);

  tick(state, 1);
  const urgency = summarize(state).mostUrgent[0];

  assert.equal(state.passengers[0]?.babyDiaperNeedsChange, true);
  assert.equal(urgency?.babyDiaperNeedsChange, true);
  assert.equal(urgency?.babyDiaperSecondsRemaining, undefined);
});

test("CLI rejects malformed lavatory assignments", () => {
  const cliPath = join(__dirname, "../src/cli.js");

  for (const assignment of ["P001:", ":front", "P001:front:extra"]) {
    const result = spawnSync(process.execPath, [cliPath, "--assign", assignment], {
      encoding: "utf8"
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--assign must use PASSENGER_ID:LAVATORY_ID/);
  }
});

test("CLI rejects invalid numeric options without hanging", () => {
  const cliPath = join(__dirname, "../src/cli.js");

  for (const [option, value, message] of [
    ["--dt", "foo", "--dt must be a finite number"],
    ["--dt", "0", "--dt must be positive"],
    ["--duration", "Infinity", "--duration must be a finite number"],
    ["--summary-interval", "-1", "--summary-interval must be positive"]
  ]) {
    const result = spawnSync(process.execPath, [cliPath, option, value], {
      encoding: "utf8",
      timeout: 1000
    });

    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(message));
  }
});

test("CLI interactive mode accepts live commands", async () => {
  const cliPath = join(__dirname, "../src/cli.js");
  const child = spawn(
    process.execPath,
    [cliPath, "--interactive", "--duration", "20", "--dt", "0.5", "--summary-interval", "30"],
    {
      stdio: ["pipe", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  await waitForOutput(() => stdout, /Interactive mode enabled/);

  child.stdin.write("help\n");
  await waitForOutput(() => stdout, /Commands:/);

  child.stdin.write("pause\n");
  await waitForOutput(() => stdout, /simulation paused\./);

  child.stdin.write("assign P001 front\n");
  await waitForOutput(() => stdout, /P001 assigned to front lavatory\./);

  child.stdin.write("cart start\n");
  await waitForOutput(() => stdout, /beverage cart started service/);

  child.stdin.write("turbulence start\n");
  await waitForOutput(() => stdout, /Turbulence warning:/);

  child.stdin.write("resume\n");
  await waitForOutput(() => stdout, /simulation resumed\./);

  child.stdin.write("quit\n");
  const exitCode = await waitForExit(child);

  assert.equal(exitCode, 0);
  assert.match(stdout, /Result: RUNNING with 0 strike\(s\)\. \(quit early\)/);
  assert.equal(stderr.trim(), "");
});

test("bot wins the readable cabin deterministically", () => {
  const first = runBotSimulation(tinyReadableCabin);
  const second = runBotSimulation(tinyReadableCabin);

  assert.equal(first.status, "won");
  assert.deepEqual(first, second);
  assert.ok(first.assignmentsMade > 0);
  assert.equal(first.finalTime, tinyReadableCabin.durationSeconds);
});

test("botStep assigns passengers that need a lavatory", () => {
  const state = createInitialState(tinyReadableCabin);
  const needyBefore = state.passengers.filter(
    (passenger) => passenger.state === "NeedsToGo" && passenger.assignedLavatoryId === undefined
  ).length;

  const assignments = botStep(state);

  assert.equal(assignments, needyBefore);
  for (const passenger of state.passengers) {
    if (passenger.state === "NeedsToGo") {
      continue;
    }
    if (passenger.assignedLavatoryId !== undefined) {
      assert.ok(state.lavatories.some((lavatory) => lavatory.id === passenger.assignedLavatoryId));
    }
  }
});

test("batch aggregation reports per-config win statistics", () => {
  const seeds = defaultSeeds(8, 100);
  const summary = runBatch(tinyReadableCabin, { seeds });

  assert.equal(summary.runCount, 8);
  assert.equal(summary.wins + summary.losses, summary.runCount);
  assert.equal(summary.winRate, summary.wins / summary.runCount);
  assert.equal(summary.runs.length, 8);
  assert.ok(summary.averageBladderPercent >= 0 && summary.averageBladderPercent <= 1);
});

test("compareConfigs returns one summary per labeled config", () => {
  const seeds = defaultSeeds(4, 7);
  const harder = {
    ...tinyReadableCabin,
    id: "single-lavatory",
    aircraft: {
      ...tinyReadableCabin.aircraft,
      lavatories: tinyReadableCabin.aircraft.lavatories.slice(-1)
    }
  };

  const comparison = compareConfigs(
    [
      { label: "baseline", config: tinyReadableCabin },
      { label: "single-lav", config: harder }
    ],
    { seeds }
  );

  assert.equal(comparison.length, 2);
  assert.deepEqual(
    comparison.map((entry) => entry.label),
    ["baseline", "single-lav"]
  );
  assert.equal(comparison[1].summary.configId, "single-lavatory");
  for (const entry of comparison) {
    assert.equal(entry.summary.runCount, 4);
  }
});

test("bot CLI prints a config comparison", () => {
  const cliPath = join(__dirname, "../src/bot-cli.js");
  const result = spawnSync(process.execPath, [cliPath, "--seeds", "3"], {
    encoding: "utf8",
    timeout: 10000
  });

  assert.equal(result.status, 0);
  assert.match(result.stdout, /automated bot runs/);
  assert.match(result.stdout, /\[baseline\]/);
  assert.match(result.stdout, /\[single-lav\]/);
  assert.match(result.stdout, /winRate=/);
});

test("medium cabin config is valid and fully populated", () => {
  const state = createInitialState(mediumCabin);
  assert.equal(state.passengers.length, 180);
  assert.equal(state.lavatories.length, 3);
  assert.ok(state.beverageCart !== undefined);
  assert.ok(state.turbulence !== undefined);
});

test("bot run reports fun metrics within valid ranges", () => {
  const result = runBotSimulation(
    { ...mediumCabin, durationSeconds: 80 },
    { dt: 0.5, startBeverageCart: true }
  );

  assert.ok(result.lavatoryUtilization >= 0 && result.lavatoryUtilization <= 1);
  assert.ok(result.busyFraction >= 0 && result.busyFraction <= 1);
  assert.ok(result.peakConcurrentDemand >= 0 && result.peakConcurrentDemand <= 180);
  assert.ok(result.meanConcurrentDemand <= result.peakConcurrentDemand);
  assert.equal(result.strategy, "greedy");
});

test("acting early (greedy) uses lavatories more than reacting late (panic)", () => {
  const seeds = defaultSeeds(3, 500);
  const config = { ...mediumCabin, durationSeconds: 120 };
  const options = { seeds, dt: 0.5, startBeverageCart: true };

  const greedy = runBatch(config, { ...options, strategy: greedyStrategy });
  const panic = runBatch(config, { ...options, strategy: panicStrategy });

  assert.ok(
    greedy.averageLavatoryUtilization > panic.averageLavatoryUtilization,
    `expected greedy util ${greedy.averageLavatoryUtilization} > panic util ${panic.averageLavatoryUtilization}`
  );
});

test("flow-control bot beats greedy by metering aisle congestion", () => {
  const seeds = defaultSeeds(5, 24680);
  const options = { seeds, dt: 0.2, startBeverageCart: true };

  const flow = runBatch(mediumCabin, { ...options, strategy: flowControlStrategy });
  const greedy = runBatch(mediumCabin, { ...options, strategy: greedyStrategy });

  assert.ok(
    flow.winRate > greedy.winRate,
    `expected flow-control winRate ${flow.winRate} > greedy winRate ${greedy.winRate}`
  );
  assert.ok(
    flow.averageStrikes < greedy.averageStrikes,
    `expected flow-control to take fewer strikes than greedy (${flow.averageStrikes} vs ${greedy.averageStrikes})`
  );
});

test("sweepConfigs returns one cell per config-by-strategy pair", () => {
  const seeds = defaultSeeds(2, 11);
  const config = { ...mediumCabin, durationSeconds: 80 };
  const variants = [
    { label: "two", config: { ...config, aircraft: { ...config.aircraft, lavatories: config.aircraft.lavatories.slice(0, 2) } } },
    { label: "three", config }
  ];

  const cells = sweepConfigs(variants, [greedyStrategy, fixedLavatoryStrategy], {
    seeds,
    dt: 0.5,
    startBeverageCart: true
  });

  assert.equal(cells.length, 4);
  assert.deepEqual(
    cells.map((cell) => `${cell.label}/${cell.strategy}`),
    ["two/greedy", "two/fixed-lavatory", "three/greedy", "three/fixed-lavatory"]
  );
});

test("an APM cap limits how many assignments the bot makes per minute", () => {
  // Start nearly everyone just below the request threshold so a large burst of
  // demand appears within seconds, making the assignment cap clearly bite.
  const config: LevelConfig = {
    ...mediumCabin,
    durationSeconds: 120,
    bladder: { ...mediumCabin.bladder, initialFillRange: [0.65, 0.69] }
  };

  const unlimited = runBotSimulation(config, { dt: 0.5, startBeverageCart: true });
  const capped = runBotSimulation(config, {
    dt: 0.5,
    startBeverageCart: true,
    actionsPerMinute: 10
  });

  assert.equal(unlimited.actionsPerMinute, Number.POSITIVE_INFINITY);
  assert.equal(capped.actionsPerMinute, 10);
  assert.ok(
    capped.assignmentsMade < unlimited.assignmentsMade,
    `expected capped ${capped.assignmentsMade} < unlimited ${unlimited.assignmentsMade}`
  );

  // 10 assignments/minute over the elapsed time is the budget, plus at most one
  // assignment of rounding slack.
  const elapsedMinutes = capped.finalTime / 60;
  assert.ok(capped.assignmentsMade <= Math.ceil(10 * elapsedMinutes) + 1);
});

test("sweepActionsPerMinute returns one cell per APM value with that cap recorded", () => {
  const seeds = defaultSeeds(2, 13);
  const config = { ...mediumCabin, durationSeconds: 80 };

  const cells = sweepActionsPerMinute(config, [15, 30, 60], {
    seeds,
    dt: 0.5,
    startBeverageCart: true
  });

  assert.deepEqual(
    cells.map((cell) => cell.actionsPerMinute),
    [15, 30, 60]
  );
  for (const cell of cells) {
    assert.equal(cell.summary.actionsPerMinute, cell.actionsPerMinute);
    assert.equal(cell.summary.runCount, 2);
  }
});

async function waitForOutput(
  readOutput: () => string,
  pattern: RegExp,
  timeoutMs = 2000
): Promise<void> {
  const start = Date.now();
  while (!pattern.test(readOutput())) {
    if (Date.now() - start >= timeoutMs) {
      throw new Error(`Timed out waiting for output: ${pattern}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function waitForExit(child: ReturnType<typeof spawn>): Promise<number | null> {
  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code));
  });
}
