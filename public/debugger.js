const config = {
  id: "tiny-readable-cabin",
  name: "Tiny Readable Cabin",
  durationSeconds: 180,
  seed: 12345,
  rows: 8,
  seatLayout: ["A", "B", "C", "D"],
  lavatories: [
    { id: "front", row: 0 },
    { id: "rear", row: 9 }
  ],
  baseFillPerSecond: 100 / 220,
  requestThreshold: 0.7,
  desperateThreshold: 0.9,
  minimumWalkSeconds: 2,
  walkSecondsPerRow: 0.75,
  passingSlowdownMultiplier: 2,
  useDurationSeconds: [8, 14],
  seatBlockers: {
    standSeconds: 1,
    sitSeconds: 1,
    standCooldownSeconds: 3
  },
  beverageCart: {
    serviceRows: [2, 3, 4, 5, 6, 7],
    rowServiceSeconds: [2, 3],
    moveSecondsPerRow: 1,
    bladderRateMultiplier: 1.35,
    bladderRateDelaySeconds: 20,
    bladderRateDurationSeconds: 45,
    autoStart: false
  }
};

const archetypes = {
  normal: { capacity: 100, multiplier: 1 },
  smallBladder: { capacity: 75, multiplier: 1.2 },
  bigBladder: { capacity: 130, multiplier: 0.85 }
};

let state = createState();
let selectedPassengerId = state.passengers[0].id;
let playing = true;
let speed = 2;
let lastFrame = performance.now();

const cabinElement = document.querySelector("#cabin");
const clockElement = document.querySelector("#clock");
const selectedElement = document.querySelector("#selectedPassenger");
const assignmentElement = document.querySelector("#assignmentButtons");
const lavatoriesElement = document.querySelector("#lavatories");
const beverageCartElement = document.querySelector("#beverageCart");
const configElement = document.querySelector("#config");
const eventLogElement = document.querySelector("#eventLog");
const playPauseElement = document.querySelector("#playPause");
const speedElement = document.querySelector("#speed");

configElement.textContent = JSON.stringify(
  {
    id: config.id,
    seed: config.seed,
    durationSeconds: config.durationSeconds,
    rows: config.rows,
    seatLayout: config.seatLayout,
    lavatories: config.lavatories,
    lavatoryTiming: {
      minimumWalkSeconds: config.minimumWalkSeconds,
      walkSecondsPerRow: config.walkSecondsPerRow,
      passingSlowdownMultiplier: config.passingSlowdownMultiplier,
      useDurationSeconds: config.useDurationSeconds
    },
    seatBlockers: config.seatBlockers,
    beverageCart: config.beverageCart
  },
  null,
  2
);

playPauseElement.addEventListener("click", () => {
  playing = !playing;
  playPauseElement.textContent = playing ? "Pause" : "Play";
});
speedElement.addEventListener("change", () => {
  speed = Number(speedElement.value);
});
document.querySelector("#step").addEventListener("click", () => {
  tick(1);
  render();
});
document.querySelector("#startCart").addEventListener("click", () => {
  startBeverageCart();
  render();
});
document.querySelector("#reset").addEventListener("click", () => {
  state = createState();
  selectedPassengerId = state.passengers[0].id;
  playing = true;
  playPauseElement.textContent = "Pause";
  render();
});

requestAnimationFrame(loop);
render();

function loop(now) {
  const elapsed = (now - lastFrame) / 1000;
  lastFrame = now;
  if (playing && state.status === "running") {
    tick(Math.min(elapsed * speed, 0.5));
    render();
  }
  requestAnimationFrame(loop);
}

function createState() {
  const rng = createRng(config.seed);
  const archetypeList = shuffle(
    [
      ...Array(24).fill("normal"),
      ...Array(4).fill("smallBladder"),
      ...Array(4).fill("bigBladder")
    ],
    rng
  );
  const passengers = [];
  for (let row = 1; row <= config.rows; row += 1) {
    for (const seat of config.seatLayout) {
      const index = passengers.length;
      const archetype = archetypeList[index] ?? "normal";
      const definition = archetypes[archetype];
      const fillPercent = range(rng, 0.05, 0.45);
      passengers.push({
        id: `P${String(index + 1).padStart(3, "0")}`,
        row,
        seat,
        archetype,
        capacity: definition.capacity,
        multiplier: definition.multiplier,
        rawBladder: definition.capacity * fillPercent,
        state: fillPercent >= config.requestThreshold ? "NeedsToGo" : "Seated",
        assignedLavatoryId: undefined,
        aisleRow: undefined,
        destinationAisleRow: undefined,
        movementStepSecondsRemaining: 0,
        movementSecondsRemaining: 0,
        lavatorySecondsRemaining: 0,
        visits: 0,
        queuePosition: undefined,
        standSecondsRemaining: 0,
        sitSecondsRemaining: 0,
        standCooldownSecondsRemaining: 0,
        blockingPassengerId: undefined,
        beverageRateMultiplier: 1,
        beverageRateModifierStartSeconds: undefined,
        beverageRateModifierEndSeconds: undefined
      });
    }
  }
  return {
    time: 0,
    status: "running",
    passengers,
    aisleCells: buildAisleCells(passengers),
    lavatories: config.lavatories.map((lavatory) => ({ ...lavatory, occupant: undefined, queue: [] })),
    beverageCart: {
      id: "beverage-cart",
      state: "ready",
      currentAisleRow: config.beverageCart.serviceRows[0],
      destinationAisleRow: undefined,
      serviceRowIndex: 0,
      serviceSecondsRemaining: 0,
      movementStepSecondsRemaining: 0,
      passengerIdsServed: []
    },
    events: []
  };
}

function tick(dt) {
  state.time = Math.min(config.durationSeconds, state.time + dt);

  updateBeverageCart(dt);
  updateSeatBlockers(dt);

  for (const passenger of state.passengers) {
    if (passenger.state === "ReturningToSeat") {
      advanceAisleMovement(passenger, dt);
    }
  }

  for (const lavatory of state.lavatories) {
    const occupant = state.passengers.find((passenger) => passenger.id === lavatory.occupant);
    if (occupant) {
      occupant.lavatorySecondsRemaining = Math.max(0, occupant.lavatorySecondsRemaining - dt);
      if (occupant.lavatorySecondsRemaining === 0) {
        lavatory.occupant = undefined;
        occupant.rawBladder = 0;
        occupant.state = "ReturningToSeat";
        occupant.queuePosition = undefined;
        startAisleMovement(occupant, occupant.row, lavatory.row);
        log(`${occupant.id} finished using ${lavatory.id} lavatory.`);
      }
    }
    if (!lavatory.occupant && lavatory.queue.length > 0) {
      const nextPassenger = findPassenger(lavatory.queue.shift());
      updateQueuePositions(lavatory);
      startUsing(lavatory, nextPassenger);
    }
  }

  for (const passenger of state.passengers) {
    if (passenger.state === "WalkingToLavatory") {
      advanceAisleMovement(passenger, dt);
    }
  }

  refreshAisleCells();

  for (const passenger of state.passengers) {
    if (passenger.state === "UsingLavatory") {
      continue;
    }
    updateBeverageModifier(passenger);
    passenger.rawBladder += config.baseFillPerSecond * passenger.multiplier * passenger.beverageRateMultiplier * dt;
    const percent = bladderPercent(passenger);
    if (passenger.state === "Seated" && percent >= config.requestThreshold) {
      passenger.state = "NeedsToGo";
      log(`${passenger.id} at ${passenger.row}${passenger.seat} needs to go.`);
    }

    function startBeverageCart() {
      const cart = state.beverageCart;
      if (!cart || cart.state !== "ready") {
        return;
      }
      log(`${cart.id} beverage cart started service at row ${cart.currentAisleRow}.`);
      startBeverageRowService(cart);
    }
    if (passenger.state !== "Panic" && percent >= 1) {
      abandonLavatoryAssignment(passenger);
      passenger.state = "Panic";
      log(`${passenger.id} at ${passenger.row}${passenger.seat} is in panic.`);
    }
  }

  if (state.time >= config.durationSeconds) {
    state.status = "won";
    log("Landed.");
  }
}

function assign(passengerId, lavatoryId) {
  const passenger = findPassenger(passengerId);
  if (passenger.state === "UsingLavatory" || passenger.state === "ReturningToSeat" || passenger.state === "Sitting") {
    return;
  }
  stopBlockingForAssignment(passenger);
  const lavatory = findLavatory(lavatoryId);
  for (const candidate of state.lavatories) {
    const previousLength = candidate.queue.length;
    candidate.queue = candidate.queue.filter((id) => id !== passengerId);
    if (candidate.queue.length !== previousLength) {
      updateQueuePositions(candidate);
    }
  }
  const oldLavatoryId = passenger.assignedLavatoryId;
  passenger.assignedLavatoryId = lavatoryId;
  startSeatExit(passenger, lavatory.row);
  log(
    oldLavatoryId && oldLavatoryId !== lavatoryId
      ? `${passenger.id} rerouted from ${oldLavatoryId} to ${lavatoryId}.`
      : `${passenger.id} assigned to ${lavatoryId} lavatory.`
  );
  render();
}

function updateSeatBlockers(dt) {
  for (const passenger of state.passengers) {
    passenger.standCooldownSecondsRemaining = Math.max(0, passenger.standCooldownSecondsRemaining - dt);
    if (passenger.state === "Standing") {
      passenger.standSecondsRemaining = Math.max(0, passenger.standSecondsRemaining - dt);
    }
    if (passenger.state === "Sitting") {
      passenger.sitSecondsRemaining = Math.max(0, passenger.sitSecondsRemaining - dt);
      if (passenger.sitSecondsRemaining === 0) {
        finishSitting(passenger);
      }
    }
  }

  for (const passenger of state.passengers) {
    if (passenger.state === "WaitingForSeatBlockers") {
      startSeatExit(passenger, findLavatory(passenger.assignedLavatoryId).row, false);
    }
    if (
      passenger.state === "Standing" &&
      !passenger.blockingPassengerId &&
      passenger.assignedLavatoryId &&
      passenger.standSecondsRemaining === 0 &&
      seatExitBlockers(passenger).every((blocker) => blocker.blockingPassengerId === passenger.id && blocker.standSecondsRemaining === 0)
    ) {
      passenger.state = "WalkingToLavatory";
      startAisleMovement(passenger, findLavatory(passenger.assignedLavatoryId).row, passenger.row);
    }
  }

  for (const blocker of state.passengers) {
    if (blocker.state !== "Standing" || !blocker.blockingPassengerId || blocker.standSecondsRemaining > 0) {
      continue;
    }
    const blockedPassenger = findPassenger(blocker.blockingPassengerId);
    if (!blockedPassenger || blockedPassenger.state === "Panic" || blockedPassenger.aisleRow !== blocker.row || blockedPassenger.destinationAisleRow === undefined) {
      startSitting(blocker);
    }
  }

  refreshAisleCells();
}

function startSeatExit(passenger, lavatoryRow, logBlocked = true) {
  releaseSeatBlockers(passenger.id);
  const blockers = seatExitBlockers(passenger);
  const unavailableBlockers = blockers.filter((blocker) => !canStandAsBlocker(blocker));
  if (unavailableBlockers.length > 0) {
    passenger.state = "WaitingForSeatBlockers";
    passenger.aisleRow = undefined;
    passenger.destinationAisleRow = lavatoryRow;
    passenger.movementSecondsRemaining = 0;
    passenger.movementStepSecondsRemaining = 0;
    passenger.standSecondsRemaining = 0;
    if (logBlocked) {
      log(`${passenger.id} is waiting for ${unavailableBlockers.map((blocker) => blocker.id).join(", ")} to stand.`);
    }
    refreshAisleCells();
    return;
  }

  for (const blocker of blockers) {
    blocker.state = "Standing";
    blocker.blockingPassengerId = passenger.id;
    blocker.aisleRow = blocker.row;
    blocker.destinationAisleRow = undefined;
    blocker.queuePosition = undefined;
    blocker.movementSecondsRemaining = 0;
    blocker.movementStepSecondsRemaining = 0;
    blocker.standSecondsRemaining = config.seatBlockers.standSeconds;
    blocker.sitSecondsRemaining = 0;
    log(`${blocker.id} stood to let ${passenger.id} out.`);
  }

  passenger.state = "Standing";
  passenger.aisleRow = passenger.row;
  passenger.destinationAisleRow = lavatoryRow;
  passenger.queuePosition = undefined;
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.standSecondsRemaining = config.seatBlockers.standSeconds;
  passenger.sitSecondsRemaining = 0;
  refreshAisleCells();

  if (passenger.standSecondsRemaining === 0 && blockers.every((blocker) => blocker.standSecondsRemaining === 0)) {
    passenger.state = "WalkingToLavatory";
    startAisleMovement(passenger, lavatoryRow, passenger.row);
  }
}

function startSitting(passenger) {
  passenger.state = "Sitting";
  passenger.aisleRow = passenger.row;
  passenger.destinationAisleRow = undefined;
  passenger.queuePosition = undefined;
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.standSecondsRemaining = 0;
  passenger.sitSecondsRemaining = config.seatBlockers.sitSeconds;
  if (passenger.sitSecondsRemaining === 0) {
    finishSitting(passenger);
  }
}

function finishSitting(passenger) {
  const wasBlocker = Boolean(passenger.blockingPassengerId);
  const blockedPassengerId = passenger.blockingPassengerId;
  passenger.blockingPassengerId = undefined;
  passenger.aisleRow = undefined;
  passenger.destinationAisleRow = undefined;
  passenger.sitSecondsRemaining = 0;
  passenger.standCooldownSecondsRemaining = config.seatBlockers.standCooldownSeconds;
  passenger.state = bladderPercent(passenger) >= config.requestThreshold ? "NeedsToGo" : "Seated";
  if (wasBlocker) {
    log(`${passenger.id} sat after letting ${blockedPassengerId} out.`);
  }
}

function seatExitBlockers(passenger) {
  const seatIndex = config.seatLayout.indexOf(passenger.seat);
  const aisleSplit = Math.ceil(config.seatLayout.length / 2);
  const blockingSeats =
    seatIndex < aisleSplit
      ? config.seatLayout.slice(seatIndex + 1, aisleSplit)
      : config.seatLayout.slice(aisleSplit, seatIndex);
  return state.passengers.filter(
    (candidate) =>
      candidate.row === passenger.row &&
      blockingSeats.includes(candidate.seat) &&
      isSeatBlockingOccupant(candidate, passenger.id)
  );
}

function isSeatBlockingOccupant(passenger, blockedPassengerId) {
  return (
    passenger.blockingPassengerId === blockedPassengerId ||
    ["Seated", "NeedsToGo", "Panic", "Sitting"].includes(passenger.state)
  );
}

function canStandAsBlocker(passenger) {
  return (
    ["Seated", "NeedsToGo", "Panic"].includes(passenger.state) &&
    passenger.standCooldownSecondsRemaining === 0 &&
    !passenger.assignedLavatoryId
  );
}

function releaseSeatBlockers(blockedPassengerId) {
  for (const blocker of state.passengers) {
    if (blocker.blockingPassengerId === blockedPassengerId) {
      startSitting(blocker);
    }
  }
}

function abandonLavatoryAssignment(passenger) {
  const blockedPassengerId = passenger.blockingPassengerId;
  releaseSeatBlockers(passenger.id);
  passenger.assignedLavatoryId = undefined;
  passenger.aisleRow = undefined;
  passenger.destinationAisleRow = undefined;
  passenger.queuePosition = undefined;
  passenger.blockingPassengerId = undefined;
  passenger.movementStepSecondsRemaining = 0;
  passenger.movementSecondsRemaining = 0;
  passenger.standSecondsRemaining = 0;
  passenger.sitSecondsRemaining = 0;
  passenger.lavatorySecondsRemaining = 0;
  removeFromLavatoryQueue(passenger.id);
  if (blockedPassengerId) {
    const blockedPassenger = state.passengers.find((candidate) => candidate.id === blockedPassengerId);
    if (blockedPassenger && ["Standing", "WaitingForSeatBlockers"].includes(blockedPassenger.state)) {
      blockedPassenger.state = "WaitingForSeatBlockers";
      blockedPassenger.aisleRow = undefined;
      blockedPassenger.standSecondsRemaining = 0;
    }
  }
  refreshAisleCells();
}

function removeFromLavatoryQueue(passengerId) {
  for (const lavatory of state.lavatories) {
    const previousLength = lavatory.queue.length;
    lavatory.queue = lavatory.queue.filter((queuedPassengerId) => queuedPassengerId !== passengerId);
    if (lavatory.queue.length !== previousLength) {
      updateQueuePositions(lavatory);
    }
  }
}

function stopBlockingForAssignment(passenger) {
  if (!passenger.blockingPassengerId) {
    return;
  }
  const blockedPassenger = findPassenger(passenger.blockingPassengerId);
  passenger.blockingPassengerId = undefined;
  if (blockedPassenger && ["Standing", "WaitingForSeatBlockers"].includes(blockedPassenger.state)) {
    blockedPassenger.state = "WaitingForSeatBlockers";
    blockedPassenger.aisleRow = undefined;
    blockedPassenger.standSecondsRemaining = 0;
  }
}

function arrive(passenger) {
  const lavatory = findLavatory(passenger.assignedLavatoryId);
  if (!lavatory.occupant && lavatory.queue.length === 0) {
    startUsing(lavatory, passenger);
    return;
  }
  passenger.state = "QueuedForLavatory";
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  if (!lavatory.queue.includes(passenger.id)) {
    lavatory.queue.push(passenger.id);
  }
  updateQueuePositions(lavatory);
  log(`${passenger.id} queued for ${lavatory.id} lavatory.`);
}

function startUsing(lavatory, passenger) {
  lavatory.occupant = passenger.id;
  passenger.state = "UsingLavatory";
  passenger.aisleRow = lavatory.row;
  passenger.destinationAisleRow = undefined;
  passenger.queuePosition = undefined;
  passenger.movementSecondsRemaining = 0;
  passenger.movementStepSecondsRemaining = 0;
  passenger.visits += 1;
  passenger.lavatorySecondsRemaining = range(createRng(hash(`${config.seed}:${passenger.id}:${passenger.visits}`)), config.useDurationSeconds[0], config.useDurationSeconds[1]);
  log(`${passenger.id} entered ${lavatory.id} lavatory.`);
}

function render() {
  clockElement.textContent = `t=${state.time.toFixed(1)}s · ${state.status}`;
  cabinElement.innerHTML = "";
  cabinElement.append(lavatoryMarker("front"));
  for (let row = 1; row <= config.rows; row += 1) {
    for (const seat of config.seatLayout) {
      if (seat === "C") {
        cabinElement.append(aisle(row));
      }
      const passenger = state.passengers.find((candidate) => candidate.row === row && candidate.seat === seat);
      cabinElement.append(seatButton(passenger));
    }
  }
  cabinElement.append(lavatoryMarker("rear"));
  renderSelected();
  renderLavatories();
  renderBeverageCart();
  renderLog();
}

function seatButton(passenger) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `seat ${passenger.id === selectedPassengerId ? "selected" : ""}`;
  button.style.background = bladderColor(bladderPercent(passenger));
  button.innerHTML = `${passenger.row}${passenger.seat}<span>${Math.round(bladderPercent(passenger) * 100)}%</span><span>${passenger.state}</span>`;
  button.addEventListener("click", () => {
    selectedPassengerId = passenger.id;
    render();
  });
  return button;
}

function aisle(row) {
  const div = document.createElement("div");
  const cell = state.aisleCells.find((candidate) => candidate.row === row);
  const passengerIds = cell?.passengerIds ?? [];
  const cartId = cell?.beverageCartId;
  const occupants = [...passengerIds, cartId ? "cart" : ""].filter(Boolean);
  div.className = `aisle ${occupants.length > 0 ? "occupied" : ""} ${cartId ? "cart" : ""}`;
  div.textContent = occupants.length > 0 ? `${row} · ${occupants.join(",")}` : String(row);
  return div;
}

function lavatoryMarker(id) {
  const div = document.createElement("button");
  const lavatory = findLavatory(id);
  div.type = "button";
  div.className = "lavatory-marker";
  div.textContent = `${id.toUpperCase()} LAV · occupant ${lavatory.occupant ?? "-"} · queue ${lavatory.queue.join(", ") || "-"}`;
  div.addEventListener("click", () => assign(selectedPassengerId, id));
  return div;
}

function renderSelected() {
  const passenger = findPassenger(selectedPassengerId);
  selectedElement.innerHTML = `<strong>${passenger.id}</strong> seat ${passenger.row}${passenger.seat}<br>${passenger.archetype} · ${Math.round(bladderPercent(passenger) * 100)}% · ${passenger.state}<br>assigned: ${passenger.assignedLavatoryId ?? "-"}<br>aisle row: ${passenger.aisleRow ?? "-"} · queue: ${passenger.queuePosition ?? "-"}<br>blocking: ${passenger.blockingPassengerId ?? "-"} · cooldown: ${passenger.standCooldownSecondsRemaining.toFixed(1)}s`;
  assignmentElement.innerHTML = "";
  for (const lavatory of state.lavatories) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = `Send to ${lavatory.id}`;
    button.addEventListener("click", () => assign(passenger.id, lavatory.id));
    assignmentElement.append(button);
  }
}

function renderBeverageCart() {
  const cart = state.beverageCart;
  beverageCartElement.textContent = cart
    ? `${cart.state} · row ${cart.currentAisleRow} · dest ${cart.destinationAisleRow ?? "-"} · ` +
      `service ${cart.serviceSecondsRemaining.toFixed(1)}s · served ${cart.passengerIdsServed.length}`
    : "Not configured";
}

function renderLavatories() {
  lavatoriesElement.innerHTML = "";
  for (const lavatory of state.lavatories) {
    const div = document.createElement("div");
    div.className = "lavatory-card";
    div.innerHTML = `<strong>${lavatory.id}</strong><br>Occupant: ${lavatory.occupant ?? "-"}<br>Queue: ${
      lavatory.queue
        .map((passengerId) => {
          const passenger = findPassenger(passengerId);
          return `${passengerId}@${passenger.aisleRow}`;
        })
        .join(", ") || "-"
    }`;
    lavatoriesElement.append(div);
  }
}

function renderLog() {
  eventLogElement.innerHTML = "";
  for (const event of state.events.slice(-80).reverse()) {
    const item = document.createElement("li");
    item.textContent = `[${event.time.toFixed(1)}s] ${event.message}`;
    eventLogElement.append(item);
  }
}

function log(message) {
  state.events.push({ time: state.time, message });
}

function bladderPercent(passenger) {
  return Math.min(passenger.rawBladder / passenger.capacity, 1);
}

function bladderColor(percent) {
  if (percent >= 1) return "#ef4444";
  if (percent >= config.desperateThreshold) return "#f97316";
  if (percent >= config.requestThreshold) return "#facc15";
  return "#22c55e";
}

function updateBeverageCart(dt) {
  const cart = state.beverageCart;
  if (!cart) return;

  if (cart.state === "servicing") {
    cart.serviceSecondsRemaining = Math.max(0, cart.serviceSecondsRemaining - dt);
    if (cart.serviceSecondsRemaining === 0) {
      finishBeverageRowService(cart);
    }
    refreshAisleCells();
    return;
  }

  if (cart.state !== "moving") return;

  let remainingDt = dt;
  while (remainingDt > 0 && cart.destinationAisleRow !== undefined) {
    if (cart.currentAisleRow === cart.destinationAisleRow) {
      startBeverageRowService(cart);
      break;
    }
    if (cart.movementStepSecondsRemaining === 0) {
      cart.movementStepSecondsRemaining = config.beverageCart.moveSecondsPerRow;
    }
    if (cart.movementStepSecondsRemaining === 0) {
      cart.currentAisleRow = nextCartAisleRow(cart);
      refreshAisleCells();
      continue;
    }
    const elapsed = Math.min(remainingDt, cart.movementStepSecondsRemaining);
    cart.movementStepSecondsRemaining = Math.max(0, cart.movementStepSecondsRemaining - elapsed);
    remainingDt -= elapsed;
    if (cart.movementStepSecondsRemaining === 0) {
      cart.currentAisleRow = nextCartAisleRow(cart);
      refreshAisleCells();
      if (cart.currentAisleRow === cart.destinationAisleRow) {
        startBeverageRowService(cart);
        break;
      }
    }
  }
}

function startBeverageRowService(cart) {
  cart.state = "servicing";
  cart.destinationAisleRow = undefined;
  cart.movementStepSecondsRemaining = 0;
  cart.currentAisleRow = config.beverageCart.serviceRows[cart.serviceRowIndex] ?? cart.currentAisleRow;
  cart.serviceSecondsRemaining = beverageRowServiceSeconds(cart.serviceRowIndex);
  log(`${cart.id} arrived to service row ${cart.currentAisleRow}.`);
  refreshAisleCells();
}

function finishBeverageRowService(cart) {
  const passengersInRow = state.passengers.filter((passenger) => passenger.row === cart.currentAisleRow);
  for (const passenger of passengersInRow) {
    passenger.beverageRateModifierStartSeconds = state.time + config.beverageCart.bladderRateDelaySeconds;
    passenger.beverageRateModifierEndSeconds =
      passenger.beverageRateModifierStartSeconds + config.beverageCart.bladderRateDurationSeconds;
    cart.passengerIdsServed.push(passenger.id);
  }
  log(`${cart.id} serviced row ${cart.currentAisleRow} (${passengersInRow.length} passenger(s)).`);

  cart.serviceRowIndex += 1;
  const nextServiceRow = config.beverageCart.serviceRows[cart.serviceRowIndex];
  if (nextServiceRow === undefined) {
    cart.state = "complete";
    cart.destinationAisleRow = undefined;
    cart.serviceSecondsRemaining = 0;
    cart.movementStepSecondsRemaining = 0;
    log(`${cart.id} completed service.`);
    refreshAisleCells();
    return;
  }

  cart.state = "moving";
  cart.destinationAisleRow = nextServiceRow;
  cart.serviceSecondsRemaining = 0;
  cart.movementStepSecondsRemaining = config.beverageCart.moveSecondsPerRow;
  log(`${cart.id} departed row ${cart.currentAisleRow} for row ${nextServiceRow}.`);
  refreshAisleCells();
}

function updateBeverageModifier(passenger) {
  passenger.beverageRateMultiplier =
    passenger.beverageRateModifierStartSeconds !== undefined &&
    passenger.beverageRateModifierEndSeconds !== undefined &&
    state.time >= passenger.beverageRateModifierStartSeconds &&
    state.time < passenger.beverageRateModifierEndSeconds
      ? config.beverageCart.bladderRateMultiplier
      : 1;
}

function nextCartAisleRow(cart) {
  return cart.currentAisleRow + Math.sign(cart.destinationAisleRow - cart.currentAisleRow);
}

function beverageRowServiceSeconds(serviceRowIndex) {
  const [min, max] = config.beverageCart.rowServiceSeconds;
  if (min === max) return min;
  return min + (max - min) * (hash(`${config.seed}:beverage-cart:${serviceRowIndex}`) / 4294967296);
}

function walkSeconds(passenger, lavatory) {
  return config.minimumWalkSeconds + Math.abs(passenger.row - lavatory.row) * config.walkSecondsPerRow;
}

function startAisleMovement(passenger, destinationAisleRow, startingAisleRow = passenger.row) {
  passenger.aisleRow = startingAisleRow;
  passenger.destinationAisleRow = destinationAisleRow;
  passenger.queuePosition = undefined;
  passenger.movementStepSecondsRemaining = config.minimumWalkSeconds || nextAisleStepSeconds(passenger);
  passenger.movementSecondsRemaining =
    config.minimumWalkSeconds + Math.abs(startingAisleRow - destinationAisleRow) * config.walkSecondsPerRow;
  refreshAisleCells();
}

function advanceAisleMovement(passenger, dt) {
  let remainingDt = dt;
  while (remainingDt > 0 && passenger.destinationAisleRow !== undefined) {
    if (passenger.movementStepSecondsRemaining === 0) {
      if (passenger.aisleRow === passenger.destinationAisleRow) {
        completeAisleMovement(passenger);
        break;
      }
      passenger.movementStepSecondsRemaining = nextAisleStepSeconds(passenger);
    }
    if (passenger.movementStepSecondsRemaining === 0) {
      passenger.aisleRow = nextAisleRow(passenger);
      refreshAisleCells();
      continue;
    }

    const elapsed = Math.min(remainingDt, passenger.movementStepSecondsRemaining);
    passenger.movementStepSecondsRemaining = Math.max(0, passenger.movementStepSecondsRemaining - elapsed);
    passenger.movementSecondsRemaining = Math.max(0, passenger.movementSecondsRemaining - elapsed);
    remainingDt -= elapsed;

    if (passenger.movementStepSecondsRemaining > 0) {
      break;
    }
    if (passenger.aisleRow === passenger.destinationAisleRow) {
      completeAisleMovement(passenger);
      break;
    }

    passenger.aisleRow = nextAisleRow(passenger);
    refreshAisleCells();
    if (passenger.aisleRow === passenger.destinationAisleRow) {
      completeAisleMovement(passenger);
      break;
    }
  }
}

function completeAisleMovement(passenger) {
  passenger.destinationAisleRow = undefined;
  passenger.movementStepSecondsRemaining = 0;
  passenger.movementSecondsRemaining = 0;

  if (passenger.state === "WalkingToLavatory") {
    arrive(passenger);
    return;
  }

  if (passenger.state === "ReturningToSeat") {
    passenger.assignedLavatoryId = undefined;
    startSitting(passenger);
    log(`${passenger.id} returned to ${passenger.row}${passenger.seat}.`);
  }
}

function nextAisleStepSeconds(passenger) {
  if (passenger.aisleRow === passenger.destinationAisleRow) {
    return 0;
  }
  const nextRow = nextAisleRow(passenger);
  const conflict = state.passengers.some(
    (candidate) =>
      candidate.id !== passenger.id &&
      isInAisle(candidate) &&
      (candidate.aisleRow === passenger.aisleRow || candidate.aisleRow === nextRow)
  );
  const cartConflict =
    state.beverageCart &&
    ["moving", "servicing"].includes(state.beverageCart.state) &&
    (state.beverageCart.currentAisleRow === passenger.aisleRow ||
      state.beverageCart.currentAisleRow === nextRow);
  return config.walkSecondsPerRow * (conflict || cartConflict ? config.passingSlowdownMultiplier : 1);
}

function nextAisleRow(passenger) {
  return passenger.aisleRow + Math.sign(passenger.destinationAisleRow - passenger.aisleRow);
}

function isInAisle(passenger) {
  return ["Standing", "WalkingToLavatory", "QueuedForLavatory", "ReturningToSeat", "Sitting"].includes(passenger.state) && passenger.aisleRow !== undefined;
}

function refreshAisleCells() {
  state.aisleCells = buildAisleCells(state.passengers);
  if (state.beverageCart && ["moving", "servicing"].includes(state.beverageCart.state)) {
    const cell = state.aisleCells.find((candidate) => candidate.row === state.beverageCart.currentAisleRow);
    if (cell) {
      cell.beverageCartId = state.beverageCart.id;
    }
  }
}

function buildAisleCells(passengers) {
  const lavatoryRows = config.lavatories.map((lavatory) => lavatory.row);
  const minRow = Math.min(1, ...lavatoryRows);
  const maxRow = Math.max(config.rows, ...lavatoryRows);
  const cells = [];
  for (let row = minRow; row <= maxRow; row += 1) {
    cells.push({
      row,
      passengerIds: passengers.filter((passenger) => isInAisle(passenger) && passenger.aisleRow === row).map((passenger) => passenger.id)
    });
  }
  return cells;
}

function updateQueuePositions(lavatory) {
  lavatory.queue.forEach((passengerId, index) => {
    const passenger = findPassenger(passengerId);
    passenger.queuePosition = index + 1;
    passenger.aisleRow = queueAisleRow(lavatory, passenger.queuePosition);
    passenger.destinationAisleRow = undefined;
    passenger.movementSecondsRemaining = 0;
    passenger.movementStepSecondsRemaining = 0;
  });
  refreshAisleCells();
}

function queueAisleRow(lavatory, queuePosition) {
  const direction = lavatory.row <= 1 ? 1 : -1;
  return clamp(lavatory.row + direction * queuePosition, 1, config.rows);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function findPassenger(id) {
  return state.passengers.find((passenger) => passenger.id === id);
}

function findLavatory(id) {
  return state.lavatories.find((lavatory) => lavatory.id === id);
}

function createRng(seed) {
  let rngState = seed >>> 0;
  return () => {
    rngState = (rngState + 0x6d2b79f5) >>> 0;
    let value = rngState;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function range(rng, min, max) {
  return min + (max - min) * rng();
}

function shuffle(items, rng) {
  const shuffled = [...items];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(range(rng, 0, index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

function hash(value) {
  let hashed = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hashed ^= value.charCodeAt(index);
    hashed = Math.imul(hashed, 16777619);
  }
  return hashed >>> 0;
}
