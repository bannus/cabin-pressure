"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createInitialState = createInitialState;
exports.tick = tick;
exports.runSimulation = runSimulation;
exports.summarize = summarize;
exports.bladderPercent = bladderPercent;
const archetypes_1 = require("./archetypes");
const rng_1 = require("./rng");
const ARCHETYPE_ORDER = [
    "normal",
    "smallBladder",
    "bigBladder",
    "babyAttachedAdult"
];
function createInitialState(config) {
    validateConfig(config);
    const rng = new rng_1.SeededRng(config.seed);
    const seats = buildSeats(config);
    const archetypes = rng.shuffle(buildArchetypeList(config, seats.length));
    const passengers = seats.map((seat, index) => {
        const archetype = archetypes[index] ?? "normal";
        const definition = archetypes_1.ARCHETYPES[archetype];
        const initialFillPercent = rng.range(config.bladder.initialFillRange[0], config.bladder.initialFillRange[1]);
        return {
            id: `P${String(index + 1).padStart(3, "0")}`,
            row: seat.row,
            seat: seat.seat,
            archetype,
            capacity: definition.capacity,
            bladderRateMultiplier: definition.bladderRateMultiplier,
            rawBladder: definition.capacity * initialFillPercent,
            state: initialFillPercent >= config.bladder.requestThreshold ? "NeedsToGo" : "Seated",
            panicSeconds: 0,
            strikeCount: 0
        };
    });
    return {
        config,
        time: 0,
        status: "running",
        strikes: 0,
        passengers,
        events: []
    };
}
function tick(state, dt) {
    if (dt <= 0) {
        throw new Error("dt must be positive");
    }
    if (state.status !== "running") {
        return state;
    }
    state.time = Math.min(state.time + dt, state.config.durationSeconds);
    for (const passenger of state.passengers) {
        updatePassengerBladder(state, passenger, dt);
        if (state.status === "lost") {
            break;
        }
    }
    if (state.status === "running" && state.time >= state.config.durationSeconds) {
        state.status = "won";
        addEvent(state, "win", `Landed with ${state.strikes} strike(s).`);
    }
    return state;
}
function runSimulation(config, dt = 0.1) {
    const state = createInitialState(config);
    while (state.status === "running") {
        tick(state, dt);
    }
    return state;
}
function summarize(state, urgentLimit = 5) {
    const urgency = state.passengers
        .map(toUrgency)
        .sort((left, right) => {
        if (right.bladderPercent !== left.bladderPercent) {
            return right.bladderPercent - left.bladderPercent;
        }
        return left.id.localeCompare(right.id);
    });
    const averageBladderPercent = urgency.reduce((total, passenger) => total + passenger.bladderPercent, 0) /
        Math.max(urgency.length, 1);
    return {
        time: state.time,
        status: state.status,
        strikes: state.strikes,
        panicCount: state.passengers.filter((passenger) => passenger.state === "Panic").length,
        needsToGoCount: state.passengers.filter((passenger) => passenger.state === "NeedsToGo").length,
        averageBladderPercent,
        mostUrgent: urgency.slice(0, urgentLimit)
    };
}
function bladderPercent(passenger) {
    return Math.min(passenger.rawBladder / passenger.capacity, 1);
}
function updatePassengerBladder(state, passenger, dt) {
    passenger.rawBladder +=
        state.config.bladder.baseFillPerSecond * passenger.bladderRateMultiplier * dt;
    const percent = bladderPercent(passenger);
    const previousState = passenger.state;
    const nextState = nextPassengerState(state, passenger, percent);
    if (previousState !== nextState) {
        passenger.state = nextState;
        if (nextState === "NeedsToGo") {
            addEvent(state, "request", `${passenger.id} at ${passenger.row}${passenger.seat} needs to go.`, passenger.id);
        }
        if (nextState === "Panic") {
            passenger.panicSeconds = 0;
            addEvent(state, "panic", `${passenger.id} at ${passenger.row}${passenger.seat} is in panic.`, passenger.id);
        }
    }
    else if (passenger.state === "Panic") {
        passenger.panicSeconds += dt;
    }
    if (passenger.state === "Panic" &&
        passenger.panicSeconds >= state.config.loss.panicGraceSeconds) {
        state.strikes += 1;
        passenger.strikeCount += 1;
        passenger.rawBladder = passenger.capacity * state.config.loss.strikeRecoveryFillPercent;
        passenger.panicSeconds = 0;
        passenger.state =
            state.config.loss.strikeRecoveryFillPercent >= state.config.bladder.requestThreshold
                ? "NeedsToGo"
                : "Seated";
        addEvent(state, "strike", `${passenger.id} caused strike ${state.strikes}/${state.config.loss.maxStrikes}.`, passenger.id);
        if (state.strikes >= state.config.loss.maxStrikes) {
            state.status = "lost";
            addEvent(state, "loss", `Flight failed after ${state.strikes} strike(s).`);
        }
    }
}
function nextPassengerState(state, passenger, percent) {
    if (percent >= 1) {
        return "Panic";
    }
    if (passenger.state === "Panic") {
        return "Panic";
    }
    if (percent >= state.config.bladder.requestThreshold) {
        return "NeedsToGo";
    }
    return "Seated";
}
function buildSeats(config) {
    const seats = [];
    for (let row = 1; row <= config.aircraft.rows; row += 1) {
        for (const seat of config.aircraft.seatLayout) {
            seats.push({ row, seat });
        }
    }
    return seats;
}
function buildArchetypeList(config, seatCount) {
    const archetypes = [];
    for (const archetype of ARCHETYPE_ORDER) {
        const count = config.passengerMix[archetype] ?? 0;
        for (let index = 0; index < count; index += 1) {
            archetypes.push(archetype);
        }
    }
    while (archetypes.length < seatCount) {
        archetypes.push("normal");
    }
    return archetypes.slice(0, seatCount);
}
function validateConfig(config) {
    if (config.aircraft.rows < 1) {
        throw new Error("aircraft.rows must be at least 1");
    }
    if (config.aircraft.seatLayout.length < 1) {
        throw new Error("aircraft.seatLayout must contain seats");
    }
    if (config.durationSeconds <= 0) {
        throw new Error("durationSeconds must be positive");
    }
    if (config.bladder.initialFillRange[0] < 0 || config.bladder.initialFillRange[1] > 1) {
        throw new Error("initialFillRange must be between 0 and 1");
    }
    if (config.bladder.initialFillRange[0] > config.bladder.initialFillRange[1]) {
        throw new Error("initialFillRange minimum must be <= maximum");
    }
    if (config.loss.maxStrikes < 1) {
        throw new Error("loss.maxStrikes must be at least 1");
    }
}
function toUrgency(passenger) {
    return {
        id: passenger.id,
        row: passenger.row,
        seat: passenger.seat,
        archetype: passenger.archetype,
        state: passenger.state,
        bladderPercent: bladderPercent(passenger),
        strikeCount: passenger.strikeCount
    };
}
function addEvent(state, type, message, passengerId) {
    state.events.push({
        time: Number(state.time.toFixed(6)),
        type,
        passengerId,
        message
    });
}
