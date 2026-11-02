import { pressureFlight } from "./config";
import {
  assignPassengerToLavatory, bladderPercent, createInitialState, setBeverageCartParked, tick
} from "./simulation";
import {
  canDispatch, cartBlocksRoute, estimateLavatoryEntry, needsHelp, recommendLavatory,
  secondsUntilAccident, serviceSlackSeconds
} from "./dispatch";
import type { Passenger } from "./types";

function element<T extends HTMLElement>(id: string, type: { new(): T }): T {
  const found = document.getElementById(id);
  if (!(found instanceof type)) throw new Error(`Missing playtest element: ${id}`);
  return found;
}
const cabin = element("cabin", HTMLDivElement);
const calls = element("calls", HTMLDivElement);
const play = element("play", HTMLButtonElement);
const park = element("park", HTMLButtonElement);
const front = element("front", HTMLButtonElement);
const rear = element("rear", HTMLButtonElement);
const sendFront = element("sendFront", HTMLButtonElement);
const sendRear = element("sendRear", HTMLButtonElement);
const seedInput = element("seed", HTMLInputElement);
const speedInput = element("speed", HTMLSelectElement);
const outcome = element("outcome", HTMLDialogElement);
const seats = new Map<string, HTMLButtonElement>();
const callCards = new Map<string, HTMLButtonElement>();
const aisles = new Map<number, HTMLDivElement>();

let seed = pressureFlight.seed;
let state = createInitialState(pressureFlight);
let selectedId = state.passengers[0].id;
let playing = false;
let started = false;
let commands = 0;
let reported = false;
let notice = "";
let noticeUntil = 0;
let accumulator = 0;
let lastFrame = performance.now();
let lastRender = 0;

function selected(): Passenger {
  const passenger = state.passengers.find((candidate) => candidate.id === selectedId);
  if (passenger === undefined) throw new Error("Selected passenger is missing");
  return passenger;
}

function reset(nextSeed: number): void {
  seed = nextSeed;
  state = createInitialState({ ...pressureFlight, seed });
  seedInput.value = String(seed);
  selectedId = state.passengers[0].id;
  playing = false;
  started = false;
  reported = false;
  commands = 0;
  accumulator = 0;
  notice = "";
  outcome.close();
  buildCabin();
  render();
}

function buildCabin(): void {
  cabin.replaceChildren();
  calls.replaceChildren();
  seats.clear();
  aisles.clear();
  callCards.clear();
  for (let row = 1; row <= state.config.aircraft.rows; row += 1) {
    const rowElement = document.createElement("div");
    rowElement.className = "cabin-row";
    for (const seat of state.config.aircraft.seatLayout) {
      if (seat === "C") {
        const aisle = document.createElement("div");
        aisle.className = "aisle";
        aisle.setAttribute("aria-label", `Aisle row ${row}`);
        aisles.set(row, aisle);
        rowElement.append(aisle);
      }
      const passenger = state.passengers.find((candidate) => candidate.row === row && candidate.seat === seat);
      if (passenger === undefined) throw new Error(`Missing seat ${row}${seat}`);
      const button = document.createElement("button");
      button.type = "button";
      button.dataset.passenger = passenger.id;
      button.id = `seat-${row}${seat}`;
      button.innerHTML = '<span class="seat-name"></span><span class="deadline"></span><small></small><span class="meter"></span>';
      button.addEventListener("click", () => {
        selectedId = passenger.id;
        if (state.status === "running" && passenger.assignedLavatoryId === undefined && canDispatch(state, passenger)) {
          dispatch(passenger, recommendLavatory(state, passenger).id);
        } else {
          render();
        }
      });
      seats.set(passenger.id, button);
      rowElement.append(button);
      const call = document.createElement("button");
      call.type = "button";
      call.className = "call-card";
      call.innerHTML = "<span><strong></strong><small></small></span><span></span>";
      call.addEventListener("click", () => dispatch(passenger, recommendLavatory(state, passenger).id));
      callCards.set(passenger.id, call);
      calls.append(call);
    }
    cabin.append(rowElement);
  }
}

function action(command: () => void): void {
  try {
    command();
    commands += 1;
    notice = "";
  } catch (error) {
    notice = error instanceof Error ? error.message : String(error);
    noticeUntil = performance.now() + 5000;
  }
  render();
}

function dispatch(passenger: Passenger, lavatoryId: string): void {
  selectedId = passenger.id;
  action(() => assignPassengerToLavatory(state, passenger.id, lavatoryId));
}

function togglePlay(): void {
  if (state.status !== "running") return;
  playing = !playing;
  started = true;
  accumulator = 0;
  lastFrame = performance.now();
  render();
}

function toggleCart(): void {
  action(() => setBeverageCartParked(state, !state.beverageCart?.parked));
}

play.addEventListener("click", togglePlay);
park.addEventListener("click", toggleCart);
front.addEventListener("click", () => dispatch(selected(), "front"));
rear.addEventListener("click", () => dispatch(selected(), "rear"));
sendFront.addEventListener("click", () => dispatch(selected(), "front"));
sendRear.addEventListener("click", () => dispatch(selected(), "rear"));
element("retry", HTMLButtonElement).addEventListener("click", () => reset(seed));
element("retryOutcome", HTMLButtonElement).addEventListener("click", () => reset(seed));
element("nextFlight", HTMLButtonElement).addEventListener("click", () => reset(seed + 1));
element("inspect", HTMLButtonElement).addEventListener("click", () => outcome.close());
element("setup", HTMLFormElement).addEventListener("submit", (event) => {
  event.preventDefault();
  const value = Number(seedInput.value);
  if (!Number.isSafeInteger(value)) {
    notice = "Seed must be a safe integer.";
    noticeUntil = performance.now() + 5000;
    render();
    return;
  }
  reset(value);
});
document.addEventListener("keydown", (event) => {
  if (event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement || outcome.open) return;
  if (event.code === "Space" && !(event.target instanceof HTMLButtonElement)) {
    event.preventDefault();
    togglePlay();
  } else if (event.key === "1") dispatch(selected(), "front");
  else if (event.key === "2") dispatch(selected(), "rear");
  else if (event.key.toLowerCase() === "c") toggleCart();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && playing) {
    playing = false;
    render();
  }
});

function clock(seconds: number): string {
  const rounded = Math.ceil(Math.max(0, seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
function deadline(seconds: number): string {
  return Number.isFinite(seconds) ? `${Math.ceil(Math.max(0, seconds))}s` : "safe";
}
function seatName(passenger: Passenger): string {
  return `${passenger.row}${passenger.seat}`;
}
function stateLabel(passenger: Passenger): string {
  if (passenger.blockingPassengerId !== undefined) return "Letting someone out";
  switch (passenger.state) {
    case "Seated": return passenger.archetype === "smallBladder" ? "Fast fill" : "Seated";
    case "NeedsToGo": return passenger.babyDiaperNeedsChange ? "Diaper call" : "Needs a loo";
    case "Panic": return "Can't wait!";
    case "WaitingForSeatBlockers": return "Waiting for seatmate";
    case "Standing": return "Getting up";
    case "WalkingToLavatory": return passenger.destinationAisleRow !== undefined &&
      cartBlocksRoute(state, passenger, passenger.destinationAisleRow)
      ? "Cart ahead" : `To ${passenger.assignedLavatoryId}`;
    case "QueuedForLavatory": return `Queue #${passenger.queuePosition}`;
    case "UsingLavatory": return `In loo ${Math.ceil(passenger.lavatorySecondsRemaining)}s`;
    case "ReturningToSeat": return "Coming back";
    case "Sitting": return "Sitting down";
  }
}

function render(): void {
  element("clock", HTMLElement).textContent = clock(state.config.durationSeconds - state.time);
  element("strikes", HTMLElement).textContent = `${state.strikes} / ${state.config.loss.maxStrikes}`;
  const cart = state.beverageCart;
  element("service", HTMLElement).textContent = `${cart?.passengerIdsServed.length ?? 0} / ${state.config.beverageCart?.requiredPassengersServed ?? 0}`;
  play.textContent = !started ? "Start flight" : playing ? "Pause" : "Resume";
  play.disabled = state.status !== "running";
  element("brief", HTMLElement).hidden = started;
  element("notice", HTMLElement).textContent = performance.now() < noticeUntil ? notice : "";
  const turbulence = state.turbulence;
  const forecast = element("forecast", HTMLElement);
  forecast.className = `forecast ${turbulence?.phase ?? ""}`;
  if (turbulence?.phase === "active") {
    forecast.textContent = `Seat belts ON for ${Math.ceil(turbulence.activeSecondsRemaining)}s. Trips return to seats; people already in a loo can finish. Cart stowed.`;
  } else if (turbulence?.phase === "warning") {
    forecast.textContent = `Seat belts in ${Math.ceil(turbulence.warningSecondsRemaining)}s, for 10s. Get people inside a loo now, or hold them until it clears.`;
  } else if (!turbulence?.hasAutoStarted) {
    forecast.textContent = `Forecast: seat belts at 1:05 elapsed (10s). Detailed warning in ${Math.ceil(Math.max(0, 45 - state.time))}s.`;
  } else {
    forecast.textContent = "Clear skies to landing. Finish service and watch for the last rush.";
  }
  let visibleCalls = 0;
  const ranked = [...state.passengers].sort((a, b) => secondsUntilAccident(state, a) - secondsUntilAccident(state, b));
  for (const passenger of state.passengers) {
    const button = seats.get(passenger.id);
    const call = callCards.get(passenger.id);
    if (button === undefined || call === undefined) throw new Error("Cabin controls missing");
    const seconds = secondsUntilAccident(state, passenger);
    const away = passenger.aisleRow !== undefined || passenger.assignedLavatoryId !== undefined;
    button.className = `seat ${needsHelp(state, passenger) ? "call" : ""} ${seconds < 18 ? "urgent" : ""} ${away ? "away" : ""} ${passenger.id === selectedId ? "selected" : ""} ${passenger.babyDiaperNeedsChange ? "diaper" : ""}`;
    button.querySelector(".seat-name")!.textContent = seatName(passenger);
    button.querySelector(".deadline")!.textContent = passenger.state === "UsingLavatory" ? "Relief!" : deadline(seconds);
    button.querySelector("small")!.textContent = stateLabel(passenger);
    const meter = button.querySelector<HTMLElement>(".meter");
    if (meter !== null) meter.style.width = `${bladderPercent(passenger) * 100}%`;
    button.setAttribute("aria-label", `${seatName(passenger)}, ${stateLabel(passenger)}, ${deadline(seconds)} before trouble${canDispatch(state, passenger) ? ", tap to dispatch or select" : ""}`);
    const visible = needsHelp(state, passenger) && passenger.assignedLavatoryId === undefined &&
      !["UsingLavatory", "ReturningToSeat", "Sitting"].includes(passenger.state);
    call.hidden = !visible;
    call.disabled = !canDispatch(state, passenger);
    if (visible) {
      visibleCalls += 1;
      call.style.order = String(ranked.indexOf(passenger));
      call.querySelector("strong")!.textContent = `${seatName(passenger)} - ${deadline(seconds)}`;
      call.querySelector("small")!.textContent = passenger.babyDiaperNeedsChange ? "Long diaper visit" : "Needs a loo";
      call.lastElementChild!.textContent = `Send ${recommendLavatory(state, passenger).id}`;
    }
  }
  element("noCalls", HTMLElement).hidden = visibleCalls > 0;
  for (const [row, aisle] of aisles) {
    aisle.replaceChildren();
    for (const passenger of state.passengers.filter((candidate) => candidate.aisleRow === row)) {
      if (passenger.state === "UsingLavatory") continue;
      const person = document.createElement("span");
      person.className = `person ${passenger.state === "ReturningToSeat" ? "returning" : ""}`;
      person.textContent = seatName(passenger);
      person.title = `${seatName(passenger)}: ${stateLabel(passenger)}`;
      aisle.append(person);
    }
    if (state.aisleCells.find((cell) => cell.row === row)?.beverageCartId !== undefined) {
      const trolley = document.createElement("span");
      trolley.className = "trolley";
      trolley.textContent = "CART";
      aisle.append(trolley);
    }
  }
  const passenger = selected();
  element("selected", HTMLElement).textContent = `${seatName(passenger)}: ${stateLabel(passenger)}. ${deadline(secondsUntilAccident(state, passenger))} before trouble.`;
  for (const [id, marker, send] of [["front", front, sendFront], ["rear", rear, sendRear]] as const) {
    const lavatory = state.lavatories.find((candidate) => candidate.id === id);
    if (lavatory === undefined) throw new Error(`Missing ${id} lavatory`);
    const occupant = state.passengers.find((candidate) => candidate.id === lavatory.occupantPassengerId);
    const entry = Math.ceil(estimateLavatoryEntry(state, passenger, lavatory));
    marker.textContent = `${id.toUpperCase()} LOO: ${occupant === undefined ? "free" : `${seatName(occupant)} (${Math.ceil(occupant.lavatorySecondsRemaining)}s)`} | queue ${lavatory.queue.length} | ~${entry}s for ${seatName(passenger)}`;
    send.textContent = `${id === "front" ? "Front" : "Rear"} ~${entry}s`;
    send.disabled = !canDispatch(state, passenger) || passenger.assignedLavatoryId === id;
    marker.disabled = send.disabled;
  }
  const activeCart = cart !== undefined && ["moving", "servicing"].includes(cart.state);
  element("cartLocation", HTMLElement).textContent = cart?.state === "complete" ? "Complete" : `Row ${cart?.currentAisleRow ?? "-"}`;
  element("cartStatus", HTMLElement).textContent = cart?.state === "complete" ? "Everyone has drinks. Keep the aisle flowing."
    : turbulence?.phase === "active" ? "Stowed for turbulence. Service paused."
    : cart?.parked ? "Aisle clear. Service paused; remember to resume."
    : cart?.maneuverSecondsRemaining ? "Moving the cart back into service..."
    : `Blocking row ${cart?.currentAisleRow}. ${cart?.state === "servicing" ? `${Math.ceil(cart.serviceSecondsRemaining)}s to serve this row.` : "Moving to the next row."}`;
  park.textContent = cart?.parked ? "Resume drink service" : "Pull cart aside";
  park.disabled = !activeCart || state.status !== "running" || turbulence?.phase === "active" || (cart?.maneuverSecondsRemaining ?? 0) > 0;
  element("serviceBudget", HTMLElement).textContent = cart?.state === "complete" ? "Service objective complete."
    : `About ${Math.max(0, Math.floor(serviceSlackSeconds(state)))}s spare for parking (after forecast turbulence). Each maneuver costs 2s.`;
  const events = element("events", HTMLOListElement);
  events.replaceChildren(...state.events.slice(-12).reverse().map((event) => {
    const item = document.createElement("li");
    item.textContent = `${state.time === 0 ? "0:00" : clock(event.time)} - ${event.message}`;
    return item;
  }));
  if (state.status !== "running" && !reported) {
    reported = true;
    playing = false;
    element("outcomeTitle", HTMLElement).textContent = state.status === "won"
      ? state.strikes === 0 ? "A spotless flight!" : state.strikes === 1 ? "A steady landing" : "Just scraped through"
      : "A rough landing";
    element("outcomeReason", HTMLElement).textContent = state.status === "won" ? "Everyone got drinks and you stayed below three incidents."
      : state.failureReason === "service" ? "Not everyone got drinks before landing. The cart needed more service time."
      : "Three incidents ended the flight. Dispatch earlier, balance the loos, or clear the cart.";
    const visits = state.passengers.reduce((sum, candidate) => sum + candidate.lavatoryVisitCount, 0);
    element("outcomeStats", HTMLElement).textContent = `Seed ${seed} | ${state.strikes} incidents | ${cart?.passengerIdsServed.length ?? 0}/16 drinks | ${visits} loo visits | ${commands} commands`;
    const lastStrike = state.events.filter((event) => event.type === "strike").at(-1);
    element("outcomeLesson", HTMLElement).textContent = lastStrike?.message ?? "Try holding safe passengers seated so urgent trips can beat the seat belt sign.";
    outcome.showModal();
  }
}

function frame(now: number): void {
  const elapsed = Math.min(0.25, (now - lastFrame) / 1000);
  lastFrame = now;
  if (playing && state.status === "running") {
    accumulator += elapsed * Number(speedInput.value);
    while (accumulator >= 0.1 && state.status === "running") {
      tick(state, 0.1);
      accumulator -= 0.1;
    }
  }
  if (now - lastRender > 100) {
    render();
    lastRender = now;
  }
  requestAnimationFrame(frame);
}
reset(seed);
requestAnimationFrame(frame);
