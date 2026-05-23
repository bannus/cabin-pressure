import assert from "node:assert/strict";
import test from "node:test";
import { tinyReadableCabin } from "../src/config";
import { createInitialState, runSimulation, tick } from "../src/simulation";
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
