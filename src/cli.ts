import { tinyReadableCabin, withLevelOverrides } from "./config";
import { assignPassengerToLavatory, summarize, tick, createInitialState } from "./simulation";

interface CliOptions {
  seed?: number;
  duration?: number;
  dt: number;
  summaryInterval: number;
  assignments: Array<{ passengerId: string; lavatoryId: string }>;
}

const options = parseArgs(process.argv.slice(2));
const config = withLevelOverrides(tinyReadableCabin, {
  seed: options.seed,
  durationSeconds: options.duration
});
const state = createInitialState(config);
for (const assignment of options.assignments) {
  assignPassengerToLavatory(state, assignment.passengerId, assignment.lavatoryId);
}
let nextSummaryAt = 0;
let printedEvents = 0;

console.log(`Cabin Pressure milestone 7 simulation`);
console.log(`Level: ${config.name} (${config.id})`);
console.log(`Seed: ${config.seed}`);
console.log(`Duration: ${config.durationSeconds}s`);
console.log(`Passengers: ${state.passengers.length}`);
console.log(`Lavatories: ${state.lavatories.map((lavatory) => lavatory.id).join(", ")}`);
console.log(`Beverage cart: ${state.beverageCart ? state.beverageCart.state : "not configured"}`);
console.log(`Turbulence: ${state.turbulence ? state.turbulence.phase : "not configured"}`);
console.log("");

while (state.status === "running") {
  if (state.time >= nextSummaryAt) {
    printSummary();
    nextSummaryAt += options.summaryInterval;
  }

  tick(state, options.dt);
  printNewEvents();
}

printSummary();
console.log("");
console.log(`Result: ${state.status.toUpperCase()} with ${state.strikes} strike(s).`);

function printSummary(): void {
  const summary = summarize(state);
  const urgent = summary.mostUrgent
    .map(
      (passenger) =>
        `${passenger.id} ${passenger.row}${passenger.seat} ${Math.round(
          passenger.bladderPercent * 100
        )}% ${passenger.state}${passenger.babyDiaperNeedsChange ? " diaper" : ""}`
    )
    .join("; ");

  console.log(
    `[t=${summary.time.toFixed(1)}s] status=${summary.status} strikes=${summary.strikes} ` +
      `panic=${summary.panicCount} needs=${summary.needsToGoCount} avg=${Math.round(
        summary.averageBladderPercent * 100
      )}%`
  );
  console.log(`  urgent: ${urgent}`);
  console.log(
    `  lavs: ${summary.lavatories
      .map(
        (lavatory) =>
          `${lavatory.id} occupant=${lavatory.occupantPassengerId ?? "-"} queue=[${lavatory.queue.join(
            ","
          )}]`
      )
      .join("; ")}`
  );
  console.log(
    `  aisle: ${summary.aisleCells
      .filter((cell) => cell.passengerIds.length > 0 || cell.beverageCartId !== undefined)
      .map(
        (cell) =>
          `${cell.row}=[${[...cell.passengerIds, cell.beverageCartId ?? ""]
            .filter((id) => id.length > 0)
            .join(",")}]`
      )
      .join("; ") || "-"}`
  );
  if (summary.beverageCart !== undefined) {
    console.log(
      `  cart: ${summary.beverageCart.state} row=${summary.beverageCart.currentAisleRow} ` +
        `dest=${summary.beverageCart.destinationAisleRow ?? "-"} served=${
          summary.beverageCart.passengerIdsServed.length
        }`
    );
  }
  if (summary.turbulence !== undefined) {
    console.log(
      `  turbulence: ${summary.turbulence.phase} warning=${summary.turbulence.warningSecondsRemaining.toFixed(
        1
      )}s active=${summary.turbulence.activeSecondsRemaining.toFixed(1)}s`
    );
  }
}

function printNewEvents(): void {
  for (const event of state.events.slice(printedEvents)) {
    console.log(`  event @ ${event.time.toFixed(1)}s: ${event.message}`);
  }
  printedEvents = state.events.length;
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    dt: 0.1,
    summaryInterval: 10,
    assignments: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--seed" && value !== undefined) {
      parsed.seed = Number(value);
      index += 1;
    } else if (arg === "--duration" && value !== undefined) {
      parsed.duration = Number(value);
      index += 1;
    } else if (arg === "--dt" && value !== undefined) {
      parsed.dt = Number(value);
      index += 1;
    } else if (arg === "--summary-interval" && value !== undefined) {
      parsed.summaryInterval = Number(value);
      index += 1;
    } else if (arg === "--assign" && value !== undefined) {
      const assignmentParts = value.split(":");
      if (assignmentParts.length !== 2 || assignmentParts.some((part) => part.length === 0)) {
        throw new Error("--assign must use PASSENGER_ID:LAVATORY_ID");
      }
      const [passengerId, lavatoryId] = assignmentParts;
      parsed.assignments.push({ passengerId, lavatoryId });
      index += 1;
    } else {
      throw new Error(`Unknown or incomplete option: ${arg}`);
    }
  }

  return parsed;
}
