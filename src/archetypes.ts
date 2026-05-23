import type { PassengerArchetype } from "./types";

export interface ArchetypeDefinition {
  capacity: number;
  bladderRateMultiplier: number;
}

export const ARCHETYPES: Record<PassengerArchetype, ArchetypeDefinition> = {
  normal: {
    capacity: 100,
    bladderRateMultiplier: 1
  },
  smallBladder: {
    capacity: 75,
    bladderRateMultiplier: 1.2
  },
  bigBladder: {
    capacity: 130,
    bladderRateMultiplier: 0.85
  },
  babyAttachedAdult: {
    capacity: 100,
    bladderRateMultiplier: 1
  }
};
