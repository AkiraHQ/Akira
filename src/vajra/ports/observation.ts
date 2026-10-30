import { Observation } from "../../contracts/events/observation";

/**
 * Architectural Port for the Observation Receiver (to be implemented in future phases).
 *
 * Ingests external and internal feedback, standardizing telemetry into Contract K4 Observations.
 */
export interface IObservationReceiver {
  ingestObservation<T = unknown>(observation: Observation<T>): void;
  getObservationsForMission(missionId: string): readonly Observation[];
  getObservationsForStep(stepId: string): readonly Observation[];
}
