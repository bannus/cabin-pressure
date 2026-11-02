import assert from "node:assert/strict";
import test from "node:test";
import { pressureFlight, tinyReadableCabin } from "../src/config";
import {
  assignPassengerToLavatory, createInitialState, setBeverageCartParked, startBeverageCart,
  startTurbulence, tick
} from "../src/simulation";
import { secondsUntilAccident, serviceSlackSeconds, estimateLavatoryEntry } from "../src/dispatch";
import { estimateLavatoryDemand } from "../src/level-metrics";
import { runTuningSimulation } from "../src/tuning";
import type { LevelConfig } from "../src/types";

function fixture(overrides: Partial<LevelConfig> = {}): LevelConfig {
  return {
    ...tinyReadableCabin, durationSeconds: 20,
    aircraft: { rows: 1, seatLayout: ["A"], lavatories: [{ id: "front", row: 0 }] },
    passengerMix: { normal: 1 },
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [0, 0], baseFillPerSecond: 0 },
    lavatory: { minimumWalkSeconds: 0, walkSecondsPerRow: 1, useDurationSeconds: [2, 2] },
    seatBlockers: { standSeconds: 0, sitSeconds: 0, standCooldownSeconds: 0 },
    beverageCart: undefined, turbulence: undefined, babyDiaper: undefined,
    ...overrides
  };
}
const cartConfig = {
  serviceRows: [1], rowServiceSeconds: [5, 5] as [number, number], moveSecondsPerRow: 1,
  bladderRateMultiplier: 1, bladderRateDelaySeconds: 0, bladderRateDurationSeconds: 0,
  autoStart: true, requiredPassengersServed: 1, maneuverSeconds: 2
};

test("reassigning a full passenger cannot reset panic, movement, or queue clocks", () => {
  const state = createInitialState(fixture({
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [1, 1], baseFillPerSecond: 0 },
    lavatory: { minimumWalkSeconds: 10, walkSecondsPerRow: 1, useDurationSeconds: [2, 2] },
    loss: { panicGraceSeconds: 1, maxStrikes: 1, strikeRecoveryFillPercent: 0.3 }
  }));
  assignPassengerToLavatory(state, "P001", "front");
  for (let index = 0; index < 4; index += 1) {
    assignPassengerToLavatory(state, "P001", "front");
    tick(state, 0.25);
  }
  assert.equal(state.status, "lost");
  assert.equal(state.failureReason, "strikes");
  assert.equal(state.events.filter((event) => event.type === "panic").length, 1);
  assert.equal(state.events.filter((event) => event.type === "lavatoryAssigned").length, 1);
});

test("rerouting preserves the aisle location and accumulated panic time", () => {
  const state = createInitialState(fixture({
    aircraft: { rows: 3, seatLayout: ["A"], lavatories: [{ id: "front", row: 0 }, { id: "rear", row: 4 }] },
    passengerMix: { normal: 3 },
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [1, 1], baseFillPerSecond: 0 }
  }));
  assignPassengerToLavatory(state, "P003", "front");
  tick(state, 1);
  assert.equal(state.passengers[2].aisleRow, 2);
  assignPassengerToLavatory(state, "P003", "rear");
  assert.equal(state.passengers[2].aisleRow, 2);
  assert.equal(state.passengers[2].panicSeconds, 1);
  tick(state, 1);
  assert.equal(state.passengers[2].panicSeconds, 2);
  assert.equal(state.events.filter((event) => event.type === "panic" && event.passengerId === "P003").length, 1);
});

test("a panicking passenger can reach a loo without losing their route", () => {
  const state = createInitialState(fixture({
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [1, 1], baseFillPerSecond: 0 }
  }));
  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.5);
  assert.equal(state.passengers[0].panicSeconds, 0.5);
  tick(state, 0.5);
  assert.equal(state.passengers[0].state, "UsingLavatory");
  assert.equal(state.passengers[0].panicSeconds, 0);
  tick(state, 2);
  assert.equal(state.passengers[0].rawBladder, 0);
  assert.equal(state.strikes, 0);
});

test("parking clears the aisle and freezes service; resuming pays the maneuver cost", () => {
  const state = createInitialState(fixture({ beverageCart: cartConfig }));
  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 1);
  assert.equal(state.passengers[0].aisleRow, 1);
  const remaining = state.beverageCart!.serviceSecondsRemaining;
  setBeverageCartParked(state, true);
  assert.equal(state.aisleCells[1].beverageCartId, undefined);
  assert.throws(() => setBeverageCartParked(state, false), /maneuver/);
  tick(state, 2);
  assert.equal(state.passengers[0].state, "UsingLavatory");
  assert.equal(state.beverageCart!.serviceSecondsRemaining, remaining);
  setBeverageCartParked(state, false);
  tick(state, 1);
  assert.equal(state.beverageCart!.serviceSecondsRemaining, remaining);
  tick(state, 2);
  assert.equal(state.beverageCart!.serviceSecondsRemaining, remaining - 1);
});

test("permanent parking fails the service objective even with no bladder accidents", () => {
  const state = createInitialState(fixture({ durationSeconds: 8, beverageCart: cartConfig }));
  setBeverageCartParked(state, true);
  tick(state, 8);
  assert.equal(state.status, "lost");
  assert.equal(state.failureReason, "service");
  assert.equal(state.strikes, 0);
  const snapshot = structuredClone(state);
  tick(state, 1);
  assert.deepEqual(state, snapshot);
  assert.throws(() => setBeverageCartParked(state, false), /only an active/);
  assert.throws(() => assignPassengerToLavatory(state, "P001", "front"), /ended/);
});

test("finishing drink service permits a win and cannot restart the objective", () => {
  const state = createInitialState(fixture({ durationSeconds: 8, beverageCart: cartConfig }));
  tick(state, 5);
  assert.deepEqual(state.beverageCart!.passengerIdsServed, ["P001"]);
  assert.throws(() => startBeverageCart(state), /already complete/);
  tick(state, 3);
  assert.equal(state.status, "won");
});

test("serving the same row twice does not double-count the service objective", () => {
  const state = createInitialState(fixture({
    beverageCart: { ...cartConfig, serviceRows: [1, 1], rowServiceSeconds: [1, 1], moveSecondsPerRow: 0 }
  }));
  for (let index = 0; index < 5; index += 1) tick(state, 1);
  assert.deepEqual(state.beverageCart!.passengerIdsServed, ["P001"]);
});

test("turbulence stows the cart, freezes service and preserves the parked setting", () => {
  const state = createInitialState(fixture({
    beverageCart: cartConfig,
    turbulence: { warningSeconds: 0, durationSeconds: [3, 3], seatBeltSignChance: 1 }
  }));
  setBeverageCartParked(state, true);
  tick(state, 2);
  startTurbulence(state);
  const remaining = state.beverageCart!.serviceSecondsRemaining;
  tick(state, 1);
  assert.equal(state.beverageCart!.serviceSecondsRemaining, remaining);
  assert.equal(state.aisleCells[1].beverageCartId, undefined);
  assert.throws(() => setBeverageCartParked(state, false), /stowed/);
  tick(state, 2);
  assert.equal(state.beverageCart!.parked, true);
});

test("ignoring a diaper call has a real deadline; being in a loo stops the clock", () => {
  const config = fixture({
    passengerMix: { babyAttachedAdult: 1 },
    babyDiaper: { firstEventSeconds: [0, 0], repeatEventSeconds: [100, 100], changeDurationSeconds: [5, 5], patienceSeconds: 2 },
    loss: { ...tinyReadableCabin.loss, maxStrikes: 1 }
  });
  const unattended = createInitialState(config);
  tick(unattended, 0.1);
  tick(unattended, 2);
  assert.equal(unattended.status, "lost");
  assert.match(unattended.events.find((event) => event.type === "strike")!.message, /diaper/);
  const rescued = createInitialState(config);
  tick(rescued, 0.1);
  assignPassengerToLavatory(rescued, "P001", "front");
  tick(rescued, 1);
  tick(rescued, 4);
  assert.equal(rescued.strikes, 0);
  tick(rescued, 1);
  assert.equal(rescued.passengers[0].babyDiaperChangeCount, 1);
  assert.equal(rescued.passengers[0].babyDiaperWaitSeconds, 0);
});

test("deadline estimates include known delayed drinks, panic grace, and diaper deadlines", () => {
  const state = createInitialState(fixture({
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [0, 0], baseFillPerSecond: 1 },
    beverageCart: { ...cartConfig, autoStart: false, bladderRateMultiplier: 2 },
    babyDiaper: { firstEventSeconds: [100, 100], repeatEventSeconds: [100, 100], changeDurationSeconds: [5, 5], patienceSeconds: 45 },
    loss: { ...tinyReadableCabin.loss, panicGraceSeconds: 10 }
  }));
  const passenger = state.passengers[0];
  passenger.beverageRateModifierStartSeconds = 10;
  passenger.beverageRateModifierEndSeconds = 20;
  assert.equal(secondsUntilAccident(state, passenger), 100);
  passenger.rawBladder = 100;
  passenger.panicSeconds = 3;
  assert.equal(secondsUntilAccident(state, passenger), 7);
  passenger.rawBladder = 0;
  passenger.panicSeconds = 0;
  passenger.babyDiaperNeedsChange = true;
  passenger.babyDiaperWaitSeconds = 5;
  assert.equal(secondsUntilAccident(state, passenger), 40);
  passenger.state = "UsingLavatory";
  assert.equal(secondsUntilAccident(state, passenger), Infinity);
});

test("weighted initial urgency is deterministic, bounded and used by demand estimates", () => {
  const config = fixture({
    bladder: { ...tinyReadableCabin.bladder, initialFillDistribution: [{ weight: 1, range: [0.72, 0.72] }] }
  });
  const first = createInitialState(config);
  assert.deepEqual(first, createInitialState(config));
  assert.equal(first.passengers[0].rawBladder, 72);
  assert.equal(first.passengers[0].state, "NeedsToGo");
  assert.ok(estimateLavatoryDemand(config).expectedBladderVisits > 0);
  for (const distribution of [[], [{ weight: 0, range: [0, 1] }], [{ weight: 1, range: [0.8, 0.1] }]]) {
    assert.throws(() => createInitialState({
      ...config, bladder: { ...config.bladder, initialFillDistribution: distribution.map((bucket) => ({
        weight: bucket.weight, range: [bucket.range[0], bucket.range[1]]
      })) }
    }), /initialFillDistribution/);
  }
});

test("service budget includes planned turbulence and entry estimates include inbound reservations", () => {
  const state = createInitialState(pressureFlight);
  assert.ok(serviceSlackSeconds(state) > 20);
  assert.ok(serviceSlackSeconds(state) < 60);
  const first = state.passengers[0];
  const next = state.passengers[1];
  assignPassengerToLavatory(state, first.id, "front");
  assert.ok(estimateLavatoryEntry(state, next, state.lavatories[0]) >= 10);
});

test("playtest policy comparisons are deterministic and command-rate limited", () => {
  const first = runTuningSimulation(pressureFlight, "planner");
  assert.deepEqual(first, runTuningSimulation(pressureFlight, "planner"));
  assert.ok(first.commands <= pressureFlight.durationSeconds / 2);
  assert.ok((first.firstDecisionSeconds ?? Infinity) <= 10);
  assert.equal(first.served, 16);
  assert.equal(first.won, true);
  assert.equal(runTuningSimulation(pressureFlight, "hands-off").won, false);
  const parked = runTuningSimulation(pressureFlight, "always-park");
  assert.equal(parked.won, false);
  assert.equal(parked.failureReason, "service");
});

test("planning improves clean outcomes over the UI's assisted reactive dispatch on fresh seeds", () => {
  const runs = Array.from({ length: 40 }, (_, index) => {
    const config = { ...pressureFlight, seed: 10000 + index };
    return {
      assisted: runTuningSimulation(config, "assisted"),
      planner: runTuningSimulation(config, "planner"),
      unattended: runTuningSimulation(config, "hands-off")
    };
  });
  const wins = runs.filter((run) => run.planner.won).length;
  const cleanPlanner = runs.filter((run) => run.planner.won && run.planner.strikes === 0).length;
  const cleanAssisted = runs.filter((run) => run.assisted.won && run.assisted.strikes === 0).length;
  assert.ok(wins >= 34, `${wins}/40 planned wins`);
  assert.ok(cleanPlanner >= cleanAssisted + 10, `${cleanPlanner} vs ${cleanAssisted} clean flights`);
  assert.ok(runs.every((run) => !run.unattended.won));
  const commandDelta = runs.reduce((sum, run) => sum + run.planner.commands - run.assisted.commands, 0);
  assert.ok(commandDelta <= 40, "planning should not require more than one extra command per flight on average");
});

test("turbulence and a new assignment cannot refresh an existing panic deadline", () => {
  const state = createInitialState(fixture({
    bladder: { ...tinyReadableCabin.bladder, initialFillRange: [1, 1], baseFillPerSecond: 0 },
    lavatory: { minimumWalkSeconds: 10, walkSecondsPerRow: 1, useDurationSeconds: [2, 2] },
    turbulence: { warningSeconds: 0, durationSeconds: [1, 1], seatBeltSignChance: 1 },
    loss: { panicGraceSeconds: 2, maxStrikes: 1, strikeRecoveryFillPercent: 0.3 }
  }));
  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.5);
  startTurbulence(state);
  assert.equal(state.passengers[0].panicSeconds, 0.5);
  tick(state, 1);
  assignPassengerToLavatory(state, "P001", "front");
  tick(state, 0.5);
  assert.equal(state.status, "lost");
  assert.equal(state.events.filter((event) => event.type === "panic").length, 1);
});

test("tactical tuning rejects impossible service quotas and nonfinite timing", () => {
  assert.throws(() => createInitialState(fixture({
    beverageCart: { ...cartConfig, requiredPassengersServed: 2 }
  })), /requiredPassengersServed/);
  assert.throws(() => createInitialState(fixture({
    beverageCart: { ...cartConfig, maneuverSeconds: NaN }
  })), /maneuverSeconds/);
  assert.throws(() => createInitialState(fixture({
    babyDiaper: { firstEventSeconds: [0, 0], repeatEventSeconds: [100, 100], changeDurationSeconds: [5, 5], patienceSeconds: Infinity }
  })), /patienceSeconds/);
  assert.throws(() => createInitialState(fixture({
    bladder: { ...tinyReadableCabin.bladder, baseFillPerSecond: NaN }
  })), /baseFillPerSecond/);
});
