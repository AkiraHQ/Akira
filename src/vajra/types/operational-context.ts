/**
 * Current operational mode of VAJRA.
 */
export type OperationalMode =
  | "REQUEST_DRIVEN"     // Reacting directly to explicit human commands
  | "PROACTIVE_MONITOR"   // Background monitoring and gentle initiative
  | "RECOVERY"            // Reconciling state after reboot, crash, or error
  | "PAUSED";             // Operational execution suspended by user or safety gate

/**
 * Observed human presence status.
 */
export type HumanPresence = "FOCUSED_ACTIVE" | "IDLE" | "AWAY";

/**
 * High-level system health status.
 */
export type SystemHealthStatus = "NOMINAL" | "DEGRADED" | "CRITICAL";

/**
 * Real-time operational context snapshot.
 */
export interface OperationalContext {
  readonly currentFocus: string;
  readonly mode: OperationalMode;
  readonly activeMissionId: string | null;
  readonly humanPresence: HumanPresence;
  readonly systemHealthStatus: SystemHealthStatus;
  readonly version: number;
  readonly updatedAt: string;
}

/**
 * Creates the initial default operational context on boot.
 */
export function createInitialOperationalContext(): OperationalContext {
  return Object.freeze({
    currentFocus: "Awaiting human directive",
    mode: "REQUEST_DRIVEN",
    activeMissionId: null,
    humanPresence: "FOCUSED_ACTIVE",
    systemHealthStatus: "NOMINAL",
    version: 1,
    updatedAt: new Date().toISOString(),
  });
}
