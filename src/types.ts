export type PassengerArchetype =
  | "normal"
  | "smallBladder"
  | "bigBladder"
  | "babyAttachedAdult";

export type PassengerState =
  | "Seated"
  | "NeedsToGo"
  | "WaitingForSeatBlockers"
  | "Standing"
  | "WalkingToLavatory"
  | "QueuedForLavatory"
  | "UsingLavatory"
  | "ReturningToSeat"
  | "Sitting"
  | "Panic";

export type SimulationStatus = "running" | "won" | "lost";

export interface AircraftConfig {
  rows: number;
  seatLayout: string[];
  lavatories: LavatoryConfig[];
}

export interface LavatoryConfig {
  id: string;
  row: number;
}

export interface PassengerMixConfig {
  normal?: number;
  smallBladder?: number;
  bigBladder?: number;
  babyAttachedAdult?: number;
}

export interface BladderConfig {
  initialFillRange: [number, number];
  baseFillPerSecond: number;
  requestThreshold: number;
  desperateThreshold: number;
}

export interface LossConfig {
  panicGraceSeconds: number;
  maxStrikes: number;
  strikeRecoveryFillPercent: number;
}

export interface LevelConfig {
  id: string;
  name: string;
  durationSeconds: number;
  seed: number;
  aircraft: AircraftConfig;
  passengerMix: PassengerMixConfig;
  bladder: BladderConfig;
  lavatory: LavatorySystemConfig;
  seatBlockers: SeatBlockerConfig;
  beverageCart?: BeverageCartConfig;
  turbulence?: TurbulenceConfig;
  babyDiaper?: BabyDiaperConfig;
  loss: LossConfig;
}

export interface LavatorySystemConfig {
  minimumWalkSeconds: number;
  walkSecondsPerRow: number;
  useDurationSeconds: [number, number];
  passingSlowdownMultiplier?: number;
}

export interface SeatBlockerConfig {
  standSeconds: number;
  sitSeconds: number;
  standCooldownSeconds: number;
}

export interface AisleCell {
  row: number;
  passengerIds: string[];
  beverageCartId?: string;
}

export interface BeverageCartConfig {
  serviceRows: number[];
  rowServiceSeconds: [number, number];
  moveSecondsPerRow: number;
  bladderRateMultiplier: number;
  bladderRateDelaySeconds: number;
  bladderRateDurationSeconds: number;
  autoStart?: boolean;
  /**
   * Extra rows on each side of the cart that are also impassable, modelling the
   * congestion wake of a cart blocking the aisle. 0 (default) blocks only the
   * cart's own cell; higher values make the cart a wider moving roadblock that
   * gates aisle access around it.
   */
  blockingWakeRows?: number;
}

export type BeverageCartState = "ready" | "moving" | "servicing" | "complete";
export type TurbulencePhase = "idle" | "warning" | "active";

export interface TurbulenceConfig {
  warningSeconds: number;
  durationSeconds: [number, number];
  seatBeltSignChance: number;
  autoStartSeconds?: number;
  /**
   * When set, turbulence re-arms after each event ends, with the next auto-start
   * scheduled this many seconds later (random within the range). Enables periodic
   * seat-belt-sign surges instead of a single one-shot event.
   */
  repeatIntervalSeconds?: [number, number];
}

export interface BabyDiaperConfig {
  firstEventSeconds: [number, number];
  repeatEventSeconds: [number, number];
  changeDurationSeconds: [number, number];
}

export interface BeverageCart {
  id: string;
  state: BeverageCartState;
  currentAisleRow: number;
  destinationAisleRow?: number;
  serviceRowIndex: number;
  serviceSecondsRemaining: number;
  movementStepSecondsRemaining: number;
  passengerIdsServed: string[];
}

export interface Turbulence {
  phase: TurbulencePhase;
  warningSecondsRemaining: number;
  activeSecondsRemaining: number;
  hasAutoStarted: boolean;
  nextStartSeconds?: number;
  willTurnSeatBeltSignOn?: boolean;
}

export interface Passenger {
  id: string;
  row: number;
  seat: string;
  archetype: PassengerArchetype;
  capacity: number;
  bladderRateMultiplier: number;
  rawBladder: number;
  state: PassengerState;
  panicSeconds: number;
  strikeCount: number;
  assignedLavatoryId?: string;
  aisleRow?: number;
  destinationAisleRow?: number;
  movementStepSecondsRemaining: number;
  movementSecondsRemaining: number;
  lavatorySecondsRemaining: number;
  lavatoryVisitCount: number;
  queuePosition?: number;
  standSecondsRemaining: number;
  sitSecondsRemaining: number;
  standCooldownSecondsRemaining: number;
  blockingPassengerId?: string;
  beverageRateMultiplier: number;
  beverageRateModifierStartSeconds?: number;
  beverageRateModifierEndSeconds?: number;
  babyDiaperSecondsRemaining?: number;
  babyDiaperNeedsChange: boolean;
  babyDiaperChangeCount: number;
}

export interface SimulationEvent {
  time: number;
  type:
    | "request"
    | "panic"
    | "strike"
    | "lavatoryAssigned"
    | "lavatoryRerouted"
    | "lavatoryQueued"
    | "lavatoryEntered"
    | "lavatoryComplete"
    | "returned"
    | "seatBlocked"
    | "seatBlockerStood"
    | "seatBlockerSat"
    | "beverageCartStarted"
    | "beverageCartArrived"
    | "beverageCartServiced"
    | "beverageCartDeparted"
    | "beverageCartComplete"
    | "turbulenceWarning"
    | "seatBeltSignOn"
    | "seatBeltSignOff"
    | "seatBeltSignSkipped"
    | "forcedReturn"
    | "babyDiaperNeeded"
    | "babyDiaperChanged"
    | "win"
    | "loss";
  passengerId?: string;
  lavatoryId?: string;
  message: string;
}

export interface Lavatory {
  id: string;
  row: number;
  occupantPassengerId?: string;
  queue: string[];
}

export interface SimulationState {
  config: LevelConfig;
  time: number;
  status: SimulationStatus;
  strikes: number;
  passengers: Passenger[];
  aisleCells: AisleCell[];
  lavatories: Lavatory[];
  beverageCart?: BeverageCart;
  turbulence?: Turbulence;
  events: SimulationEvent[];
}

export interface SimulationSummary {
  time: number;
  status: SimulationStatus;
  strikes: number;
  panicCount: number;
  needsToGoCount: number;
  averageBladderPercent: number;
  aisleCells: AisleCell[];
  lavatories: LavatorySummary[];
  beverageCart?: BeverageCart;
  turbulence?: Turbulence;
  mostUrgent: PassengerUrgency[];
}

export interface LavatorySummary {
  id: string;
  row: number;
  occupantPassengerId?: string;
  queue: string[];
}

export interface PassengerUrgency {
  id: string;
  row: number;
  seat: string;
  archetype: PassengerArchetype;
  state: PassengerState;
  bladderPercent: number;
  strikeCount: number;
  assignedLavatoryId?: string;
  aisleRow?: number;
  queuePosition?: number;
  blockingPassengerId?: string;
  standCooldownSecondsRemaining: number;
  beverageRateMultiplier: number;
  beverageRateModifierStartSeconds?: number;
  beverageRateModifierEndSeconds?: number;
  babyDiaperNeedsChange: boolean;
  babyDiaperSecondsRemaining?: number;
  babyDiaperChangeCount: number;
}
