"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = __importDefault(require("node:test"));
const config_1 = require("../src/config");
const simulation_1 = require("../src/simulation");
(0, node_test_1.default)("passenger generation is deterministic for the same seed", () => {
    const first = (0, simulation_1.createInitialState)(config_1.tinyReadableCabin);
    const second = (0, simulation_1.createInitialState)(config_1.tinyReadableCabin);
    strict_1.default.deepEqual(first.passengers.map((passenger) => ({
        id: passenger.id,
        row: passenger.row,
        seat: passenger.seat,
        archetype: passenger.archetype,
        rawBladder: Number(passenger.rawBladder.toFixed(6))
    })), second.passengers.map((passenger) => ({
        id: passenger.id,
        row: passenger.row,
        seat: passenger.seat,
        archetype: passenger.archetype,
        rawBladder: Number(passenger.rawBladder.toFixed(6))
    })));
});
(0, node_test_1.default)("unattended low-pressure flight can win at landing", () => {
    const config = {
        ...config_1.tinyReadableCabin,
        durationSeconds: 5,
        aircraft: {
            ...config_1.tinyReadableCabin.aircraft,
            rows: 1,
            seatLayout: ["A"]
        },
        passengerMix: { normal: 1 },
        bladder: {
            ...config_1.tinyReadableCabin.bladder,
            initialFillRange: [0.05, 0.05],
            baseFillPerSecond: 0
        }
    };
    const result = (0, simulation_1.runSimulation)(config);
    strict_1.default.equal(result.status, "won");
    strict_1.default.equal(result.strikes, 0);
    strict_1.default.equal(result.events.at(-1)?.type, "win");
});
(0, node_test_1.default)("panic grace produces strikes and loss", () => {
    const config = {
        ...config_1.tinyReadableCabin,
        durationSeconds: 10,
        aircraft: {
            ...config_1.tinyReadableCabin.aircraft,
            rows: 1,
            seatLayout: ["A"]
        },
        passengerMix: { normal: 1 },
        bladder: {
            ...config_1.tinyReadableCabin.bladder,
            initialFillRange: [1, 1],
            baseFillPerSecond: 0
        },
        loss: {
            panicGraceSeconds: 0.5,
            maxStrikes: 2,
            strikeRecoveryFillPercent: 1
        }
    };
    const result = (0, simulation_1.runSimulation)(config);
    strict_1.default.equal(result.status, "lost");
    strict_1.default.equal(result.strikes, 2);
    strict_1.default.equal(result.events.filter((event) => event.type === "strike").length, 2);
    strict_1.default.equal(result.events.at(-1)?.type, "loss");
});
