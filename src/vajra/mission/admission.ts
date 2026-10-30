import { ExecutiveAction } from "../types/action";
import { IOperationalStateStore } from "../ports/state-store";
import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import { OperationalContext } from "../types/operational-context";
import { ApprovalManager } from "../decision/approval-manager";
import { DEFAULT_POLICY_ENVELOPE, PolicyEnvelope } from "../types/policy";
import { MissionAdmissionOutcome } from "./types";

export interface IMissionAdmissionGateway {
  admitAction(
    action: ExecutiveAction,
    operationalContext?: OperationalContext | null,
  ): Promise<MissionAdmissionOutcome>;
}

/**
 * Deterministic gating barrier that validates incoming ExecutiveActions
 * before compilation into formal MissionDefinitions.
 */
export class MissionAdmissionGateway implements IMissionAdmissionGateway {
  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly capabilityRegistry?: CapabilityRegistry,
    private readonly approvalManager?: ApprovalManager,
  ) {}

  async admitAction(
    action: ExecutiveAction,
    operationalContext?: OperationalContext | null,
  ): Promise<MissionAdmissionOutcome> {
    // Gate 1: Kind Verification (strictly canonical "start_mission")
    if (action.kind !== "start_mission") {
      return {
        status: "REJECTED",
        reason: `Unsupported action kind '${action.kind}'. Admission requires canonical 'start_mission'.`,
      };
    }

    // Gate 2: Structural Integrity Verification
    if (!action.id || typeof action.id !== "string") {
      return { status: "REJECTED", reason: "Action is missing a valid id." };
    }
    if (
      typeof action.confidence !== "number" ||
      Number.isNaN(action.confidence) ||
      action.confidence < 0 ||
      action.confidence > 1
    ) {
      return { status: "REJECTED", reason: "Action confidence must be a finite number in [0, 1]." };
    }
    if (action.policyCompliance !== true) {
      return { status: "REJECTED", reason: "Action is marked as not policy compliant." };
    }
    if (
      !action.correlation ||
      !action.correlation.requestId ||
      !action.correlation.correlationId ||
      !action.correlation.invocationId
    ) {
      return { status: "REJECTED", reason: "Action is missing required CorrelationMetadata (Contract K19)." };
    }

    // Gate 3: Human Approval State Verification
    if (
      action.approvalState === "APPROVAL_REQUIRED" ||
      action.approvalState === "WAITING_FOR_HUMAN"
    ) {
      if (!action.escalationId) {
        return {
          status: "REJECTED",
          reason: "Action requires human approval but carries no escalationId.",
        };
      }
      if (this.approvalManager) {
        const contextToUse: OperationalContext = operationalContext ?? {
          currentFocus: "Mission admission",
          mode: "REQUEST_DRIVEN",
          activeMissionId: null,
          humanPresence: "FOCUSED_ACTIVE",
          systemHealthStatus: "NOMINAL",
          version: action.stateVersion ?? 1,
          updatedAt: new Date().toISOString(),
        };
        const policyToUse: PolicyEnvelope = {
          ...DEFAULT_POLICY_ENVELOPE,
          policyVersion: action.policyVersion ?? DEFAULT_POLICY_ENVELOPE.policyVersion,
        };
        const validation = await this.approvalManager.validateApproval(
          action.escalationId,
          contextToUse,
          policyToUse,
        );
        if (validation.status === "WAITING_FOR_HUMAN") {
          return {
            status: "PAUSED_APPROVAL",
            escalationId: action.escalationId,
            reason: validation.reason ?? "Action requires human confirmation; awaiting resolution.",
          };
        }
        if (validation.status === "REJECTED") {
          return { status: "REJECTED", reason: validation.reason ?? "Human rejected proposed action." };
        }
        if (validation.status === "EXPIRED") {
          return { status: "EXPIRED", reason: validation.reason ?? "Human approval escalation has expired." };
        }
        if (validation.status === "STALE") {
          return { status: "STALE", reason: validation.reason ?? "Approval state is stale." };
        }
      } else {
        return {
          status: "PAUSED_APPROVAL",
          escalationId: action.escalationId,
          reason: "Action requires human confirmation; awaiting resolution.",
        };
      }
    } else if (action.approvalState === "REJECTED") {
      return { status: "REJECTED", reason: "Human rejected proposed action." };
    } else if (action.approvalState === "EXPIRED") {
      return { status: "EXPIRED", reason: "Human approval escalation has expired." };
    } else if (action.approvalState === "STALE") {
      return { status: "STALE", reason: "Approval state is stale." };
    }

    // Gate 4: State Version Staleness Guard
    if (
      action.stateVersion !== undefined &&
      operationalContext?.version !== undefined &&
      action.stateVersion !== operationalContext.version
    ) {
      return {
        status: "STALE",
        reason: `Context version drift: action stateVersion (${action.stateVersion}) != active context version (${operationalContext.version}).`,
      };
    }

    // Gate 5: System Health Gate
    if (operationalContext?.systemHealthStatus === "CRITICAL") {
      return {
        status: "HEALTH_DEGRADED",
        reason: "Operational context indicates CRITICAL system health. Operational admission blocked.",
      };
    }

    // Gate 6: Single Running Mission Lock
    const activeMission = await this.stateStore.getActiveMission();
    if (activeMission && activeMission.lifecycleState === "RUNNING") {
      return {
        status: "CONCURRENCY_LOCKED",
        activeMissionId: activeMission.id,
        reason: `Concurrency conflict: mission '${activeMission.id}' is currently RUNNING.`,
      };
    }

    // Gate 7: Capability Pre-Flight Check
    if (action.requiredCapability && this.capabilityRegistry) {
      const capName = action.requiredCapability;
      if (!this.capabilityRegistry.has(capName)) {
        return {
          status: "CAPABILITY_UNAVAILABLE",
          missingCapability: capName,
          reason: `Required capability '${capName}' is not registered.`,
        };
      }
      const entry = this.capabilityRegistry.get(capName);
      if (!entry || !entry.descriptor.isAvailable) {
        return {
          status: "CAPABILITY_UNAVAILABLE",
          missingCapability: capName,
          reason: `Required capability '${capName}' is currently unavailable.`,
        };
      }
      if (entry.descriptor.permissions.allowVajra === false) {
        return {
          status: "CAPABILITY_UNAVAILABLE",
          missingCapability: capName,
          reason: `Required capability '${capName}' disallows VAJRA invocation.`,
        };
      }
    }

    // Gate 8: Idempotency De-duplication
    const idempotencyKey =
      action.idempotencyKey ??
      `idemp-mission-${action.id}-${action.stateVersion ?? 0}`;

    // Query existing mission by id to detect duplicates
    const existingMission = await this.stateStore.getMission(action.id);
    if (existingMission) {
      return {
        status: "DUPLICATE_ADMISSION",
        existingMissionId: existingMission.id,
        reason: `Mission '${existingMission.id}' has already been admitted.`,
      };
    }

    return {
      status: "ADMITTED",
      action,
      correlation: action.correlation,
      idempotencyKey,
    };
  }
}
