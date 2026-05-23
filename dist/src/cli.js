"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const config_1 = require("./config");
const simulation_1 = require("./simulation");
const options = parseArgs(process.argv.slice(2));
const config = (0, config_1.withLevelOverrides)(config_1.tinyReadableCabin, {
    seed: options.seed,
    durationSeconds: options.duration
});
const state = (0, simulation_1.createInitialState)(config);
let nextSummaryAt = 0;
let printedEvents = 0;
console.log(`Cabin Pressure milestone 1 simulation`);
console.log(`Level: ${config.name} (${config.id})`);
console.log(`Seed: ${config.seed}`);
console.log(`Duration: ${config.durationSeconds}s`);
console.log(`Passengers: ${state.passengers.length}`);
console.log("");
while (state.status === "running") {
    if (state.time >= nextSummaryAt) {
        printSummary();
        nextSummaryAt += options.summaryInterval;
    }
    (0, simulation_1.tick)(state, options.dt);
    printNewEvents();
}
printSummary();
console.log("");
console.log(`Result: ${state.status.toUpperCase()} with ${state.strikes} strike(s).`);
function printSummary() {
    const summary = (0, simulation_1.summarize)(state);
    const urgent = summary.mostUrgent
        .map((passenger) => `${passenger.id} ${passenger.row}${passenger.seat} ${Math.round(passenger.bladderPercent * 100)}% ${passenger.state}`)
        .join("; ");
    console.log(`[t=${summary.time.toFixed(1)}s] status=${summary.status} strikes=${summary.strikes} ` +
        `panic=${summary.panicCount} needs=${summary.needsToGoCount} avg=${Math.round(summary.averageBladderPercent * 100)}%`);
    console.log(`  urgent: ${urgent}`);
}
function printNewEvents() {
    for (const event of state.events.slice(printedEvents)) {
        console.log(`  event @ ${event.time.toFixed(1)}s: ${event.message}`);
    }
    printedEvents = state.events.length;
}
function parseArgs(args) {
    const parsed = {
        dt: 0.1,
        summaryInterval: 10
    };
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        const value = args[index + 1];
        if (arg === "--seed" && value !== undefined) {
            parsed.seed = Number(value);
            index += 1;
        }
        else if (arg === "--duration" && value !== undefined) {
            parsed.duration = Number(value);
            index += 1;
        }
        else if (arg === "--dt" && value !== undefined) {
            parsed.dt = Number(value);
            index += 1;
        }
        else if (arg === "--summary-interval" && value !== undefined) {
            parsed.summaryInterval = Number(value);
            index += 1;
        }
        else {
            throw new Error(`Unknown or incomplete option: ${arg}`);
        }
    }
    return parsed;
}
