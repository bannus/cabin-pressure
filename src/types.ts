export type PassengerArchetype =
  | "normal"
  | "smallBladder"
  | "bigBladder"
  | "babyAttachedAdult";

export type PassengerState = "Seated" | "NeedsToGo" | "Panic";

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
  loss: LossConfig;
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
}

export interface SimulationEvent {
  time: number;
  type: "request" | "panic" | "strike" | "win" | "loss";
  passengerId?: string;
  message: string;
}

export interface SimulationState {
  config: LevelConfig;
  time: number;
  status: SimulationStatus;
  strikes: number;
  passengers: Passenger[];
  events: SimulationEvent[];
}

export interface SimulationSummary {
  time: number;
  status: SimulationStatus;
  strikes: number;
  panicCount: number;
  needsToGoCount: number;
  averageBladderPercent: number;
  mostUrgent: PassengerUrgency[];
}

export interface PassengerUrgency {
  id: string;
  row: number;
  seat: string;
  archetype: PassengerArchetype;
  state: PassengerState;
  bladderPercent: number;
  strikeCount: number;
}
