/**
 * Operational stages participating in K19 correlation provenance reconstruction.
 */
export type ProvenanceStage =
  | "deliberation"
  | "mission"
  | "step"
  | "escalation"
  | "verification";

/**
 * Reconstructed unified provenance node representing a historical event in an execution trail.
 */
export interface ProvenanceRecord {
  readonly stage: ProvenanceStage;
  readonly id: string;
  readonly description: string;
  readonly timestamp: string;
}
