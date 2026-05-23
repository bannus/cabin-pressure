export type PassengerArchetype =
  | "normal"
  | "smallBladder"
  | "bigBladder"
  | "babyAttachedAdult";

export type PassengerState =
  | "Seated"
  | "NeedsToGo"
  | "WalkingToLavatory"
  | "QueuedForLavatory"
  | "UsingLavatory"
  | "ReturningToSeat"
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
  loss: LossConfig;
}

export interface LavatorySystemConfig {
  minimumWalkSeconds: number;
  walkSecondsPerRow: number;
  useDurationSeconds: [number, number];
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
  movementSecondsRemaining: number;
  lavatorySecondsRemaining: number;
  lavatoryVisitCount: number;
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
  lavatories: Lavatory[];
  events: SimulationEvent[];
}

export interface SimulationSummary {
  time: number;
  status: SimulationStatus;
  strikes: number;
  panicCount: number;
  needsToGoCount: number;
  averageBladderPercent: number;
  lavatories: LavatorySummary[];
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
}
