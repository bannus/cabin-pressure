import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { tinyReadableCabin } from "../src/config";
import { assignPassengerToLavatory, createInitialState, runSimulation, tick } from "../src/simulation";
import type { LevelConfig } from "../src/types";

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
    }
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
    }
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
    }
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
      seatLayout: ["A", "B", "C"],
      lavatories: [{ id: "front", row: 0 }]
    },
    passengerMix: { normal: 9 },
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
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assignPassengerToLavatory(state, "P002", "front");
  assignPassengerToLavatory(state, "P003", "front");
  tick(state, 1);

  assert.equal(state.passengers[0]?.state, "UsingLavatory");
  assert.equal(state.passengers[1]?.state, "QueuedForLavatory");
  assert.equal(state.passengers[1]?.queuePosition, 1);
  assert.equal(state.passengers[1]?.aisleRow, 1);
  assert.equal(state.passengers[2]?.queuePosition, 2);
  assert.equal(state.passengers[2]?.aisleRow, 2);
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 1)?.passengerIds, ["P002"]);
  assert.deepEqual(state.aisleCells.find((cell) => cell.row === 2)?.passengerIds, ["P003"]);
});

test("passing conflicts slow aisle movement", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 30,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 2,
      seatLayout: ["A", "B"],
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
      walkSecondsPerRow: 1,
      passingSlowdownMultiplier: 3,
      useDurationSeconds: [5, 5]
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P003", "front");
  assignPassengerToLavatory(state, "P004", "front");
  tick(state, 1);

  assert.equal(state.passengers[2]?.aisleRow, 1);
  assert.equal(state.passengers[3]?.aisleRow, 2);
  assert.equal(state.passengers[3]?.movementStepSecondsRemaining, 2);
});

test("passengers can panic while walking to a lavatory", () => {
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
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.25);

  assert.equal(state.passengers[0]?.state, "Panic");
  assert.equal(state.passengers[0]?.assignedLavatoryId, undefined);
  assert.equal(state.passengers[0]?.movementSecondsRemaining, 0);
  assert.equal(state.events.at(-1)?.type, "panic");
});

test("passengers can panic while queued for a lavatory", () => {
  const config: LevelConfig = {
    ...tinyReadableCabin,
    durationSeconds: 10,
    aircraft: {
      ...tinyReadableCabin.aircraft,
      rows: 1,
      seatLayout: ["A", "B"],
      lavatories: [{ id: "front", row: 1 }]
    },
    passengerMix: { normal: 2 },
    bladder: {
      ...tinyReadableCabin.bladder,
      initialFillRange: [0.99, 0.99],
      baseFillPerSecond: 4
    },
    lavatory: {
      minimumWalkSeconds: 1,
      walkSecondsPerRow: 0,
      useDurationSeconds: [5, 5]
    }
  };
  const state = createInitialState(config);

  assignPassengerToLavatory(state, "P001", "front");
  assignPassengerToLavatory(state, "P002", "front");
  tick(state, 1);

  assert.equal(state.passengers[1]?.state, "Panic");
  assert.equal(state.passengers[1]?.assignedLavatoryId, undefined);
  assert.deepEqual(state.lavatories[0]?.queue, []);
  assert.equal(state.events.at(-1)?.type, "panic");
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
