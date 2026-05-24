import { tinyReadableCabin, withLevelOverrides } from "./config";
import { estimateLavatoryDemand } from "./level-metrics";
import { createInterface } from "node:readline";
import {
  assignPassengerToLavatory,
  createInitialState,
  startBeverageCart,
  startTurbulence,
  summarize,
  tick
} from "./simulation";

interface CliOptions {
  seed?: number;
  duration?: number;
  dt: number;
  summaryInterval: number;
  interactive: boolean;
  assignments: Array<{ passengerId: string; lavatoryId: string }>;
}

void run().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
async function run(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const config = withLevelOverrides(tinyReadableCabin, {
    seed: options.seed,
    durationSeconds: options.duration
  });
  const state = createInitialState(config);
  const lavatoryEstimate = estimateLavatoryDemand(config);
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
  console.log(
    `Lavatory demand ratio: ${lavatoryEstimate.demandToSupplyRatio.toFixed(3)} ` +
      `(demand=${lavatoryEstimate.expectedDemandSeconds.toFixed(1)}s ` +
      `supply=${lavatoryEstimate.perfectUtilizationSupplySeconds.toFixed(1)}s)`
  );
  console.log(`Beverage cart: ${state.beverageCart ? state.beverageCart.state : "not configured"}`);
  console.log(`Turbulence: ${state.turbulence ? state.turbulence.phase : "not configured"}`);
  console.log("");

  if (!options.interactive) {
    while (state.status === "running") {
      if (state.time >= nextSummaryAt) {
        printSummary();
        nextSummaryAt += options.summaryInterval;
      }

      tick(state, options.dt);
      printNewEvents();
    }
  } else {
    await runInteractiveMode();
  }

  printSummary();
  console.log("");
  console.log(
    `Result: ${state.status.toUpperCase()} with ${state.strikes} strike(s).` +
      (options.interactive && state.status === "running" ? " (quit early)" : "")
  );

  async function runInteractiveMode(): Promise<void> {
    const commandQueue: string[] = [];
    const input = createInterface({
      input: process.stdin,
      output: process.stdout
    });
    let paused = false;
    let quitRequested = false;
    const tickIntervalMs = Math.max(1, Math.round(options.dt * 1000));

    console.log(`Interactive mode enabled. Type "help" for commands.`);

    input.on("line", (line) => {
      commandQueue.push(line.trim());
    });

    const executeStep = (): boolean => {
      processCommandQueue();
      if (quitRequested || state.status !== "running") {
        return false;
      }

      if (paused) {
        return true;
      }

      if (state.time >= nextSummaryAt) {
        printSummary();
        nextSummaryAt += options.summaryInterval;
      }

      tick(state, options.dt);
      printNewEvents();
      return state.status === "running";
    };

    while (executeStep()) {
      await sleep(tickIntervalMs);
    }

    input.close();

    function processCommandQueue(): void {
      while (commandQueue.length > 0) {
        const raw = commandQueue.shift();
        if (raw === undefined || raw.length === 0) {
          continue;
        }

        const command = parseInteractiveCommand(raw);
        try {
          if (command.type === "help") {
            printInteractiveHelp();
            continue;
          }
          if (command.type === "status") {
            printSummary();
            continue;
          }
          if (command.type === "quit") {
            quitRequested = true;
            console.log(`  command: quitting interactive session.`);
            continue;
          }
          if (state.status !== "running") {
            throw new Error(`simulation has already ended`);
          }

          if (command.type === "pause") {
            paused = true;
            console.log(`  command: simulation paused.`);
            continue;
          }
          if (command.type === "resume") {
            paused = false;
            console.log(`  command: simulation resumed.`);
            continue;
          }
          if (command.type === "assign") {
            assignPassengerToLavatory(state, command.passengerId, command.lavatoryId);
            printNewEvents();
            continue;
          }
          if (command.type === "startCart") {
            startBeverageCart(state);
            printNewEvents();
            continue;
          }
          if (command.type === "startTurbulence") {
            startTurbulence(state);
            printNewEvents();
            continue;
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          console.error(`  command error: ${message}`);
        }
      }
    }
  }

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
}

type InteractiveCommand =
  | { type: "help" }
  | { type: "status" }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "quit" }
  | { type: "startCart" }
  | { type: "startTurbulence" }
  | { type: "assign"; passengerId: string; lavatoryId: string };

function parseInteractiveCommand(raw: string): InteractiveCommand {
  const [verb, ...args] = raw.split(/\s+/);
  const command = verb.toLowerCase();

  if (command === "help" || command === "h" || command === "?") {
    return { type: "help" };
  }
  if (command === "status") {
    return { type: "status" };
  }
  if (command === "pause") {
    return { type: "pause" };
  }
  if (command === "resume") {
    return { type: "resume" };
  }
  if (command === "quit" || command === "exit") {
    return { type: "quit" };
  }
  if ((command === "cart" && args[0] === "start") || command === "start-cart") {
    return { type: "startCart" };
  }
  if ((command === "turbulence" && args[0] === "start") || command === "start-turbulence") {
    return { type: "startTurbulence" };
  }
  if (command === "assign") {
    if (args.length === 1) {
      const assignmentParts = args[0].split(":");
      if (assignmentParts.length === 2 && assignmentParts.every((part) => part.length > 0)) {
        const [passengerId, lavatoryId] = assignmentParts;
        return { type: "assign", passengerId, lavatoryId };
      }
    }
    if (args.length >= 2 && args[0].length > 0 && args[1].length > 0) {
      return { type: "assign", passengerId: args[0], lavatoryId: args[1] };
    }
    throw new Error("assign must use: assign PASSENGER_ID LAVATORY_ID");
  }
  throw new Error(`unknown command: ${raw}`);
}

function printInteractiveHelp(): void {
  console.log(`Commands:`);
  console.log(`  assign PASSENGER_ID LAVATORY_ID`);
  console.log(`  assign PASSENGER_ID:LAVATORY_ID`);
  console.log(`  cart start`);
  console.log(`  turbulence start`);
  console.log(`  pause`);
  console.log(`  resume`);
  console.log(`  status`);
  console.log(`  help`);
  console.log(`  quit`);
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function parseArgs(args: string[]): CliOptions {
  const parsed: CliOptions = {
    dt: 0.1,
    summaryInterval: 10,
    interactive: false,
    assignments: []
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];
    if (arg === "--seed" && value !== undefined) {
      parsed.seed = parseFiniteNumber(value, "--seed");
      index += 1;
    } else if (arg === "--duration" && value !== undefined) {
      parsed.duration = parsePositiveFiniteNumber(value, "--duration");
      index += 1;
    } else if (arg === "--dt" && value !== undefined) {
      parsed.dt = parsePositiveFiniteNumber(value, "--dt");
      index += 1;
    } else if (arg === "--summary-interval" && value !== undefined) {
      parsed.summaryInterval = parsePositiveFiniteNumber(value, "--summary-interval");
      index += 1;
    } else if (arg === "--interactive") {
      parsed.interactive = true;
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

function parseFiniteNumber(value: string, optionName: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${optionName} must be a finite number`);
  }
  return parsed;
}

function parsePositiveFiniteNumber(value: string, optionName: string): number {
  const parsed = parseFiniteNumber(value, optionName);
  if (parsed <= 0) {
    throw new Error(`${optionName} must be positive`);
  }
  return parsed;
}
