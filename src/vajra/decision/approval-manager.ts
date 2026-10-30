import { CorrelationMetadata } from "../../contracts/results/result";
import { OperationalContext } from "../types/operational-context";
import { PolicyEnvelope } from "../types/policy";
import { IOperationalStateStore } from "../ports/state-store";
import { IEscalationPort } from "../boundaries/escalation-port";
import {
  VajraEscalationRecord,
  createVajraEscalationRecord,
  EscalationStatus,
} from "../types/escalation-record";
import {
  DecisionOption,
  ApprovalGateDescriptor,
  DecisionApprovalState,
} from "./types";

/**
 * Manages human approval escalations per Contract K1.
 * Ensures approvals are tightly bound to state version, policy version, and capability state.
 */
export class ApprovalManager {
  constructor(
    private readonly stateStore: IOperationalStateStore,
    private readonly escalationPort?: IEscalationPort,
  ) {}

  /**
   * Initiates a durable human approval gate in vajra_escalations.
   */
  async createApprovalGate(opts: {
    decisionId: string;
    actionId: string;
    option: DecisionOption;
    context: OperationalContext;
    policy: PolicyEnvelope;
    rationale: string;
    correlation: CorrelationMetadata;
    scope?: string;
  }): Promise<VajraEscalationRecord> {
    const ttlMs = opts.policy.approvalTtlMs ?? 86_400_000;
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();

    const descriptor: ApprovalGateDescriptor = {
      decisionId: opts.decisionId,
      actionId: opts.actionId,
      contextVersion: opts.context.version,
      policyVersion: opts.policy.policyVersion ?? "1.0.0",
      capabilityFingerprint: opts.option.targetCapability,
      scope: opts.scope ?? "desktop_operation",
      proposedAction: opts.option,
      riskExplanation: opts.rationale,
      createdAt: new Date().toISOString(),
      expiresAt,
    };

    const record = createVajraEscalationRecord({
      id: `esc-${opts.decisionId}`,
      status: "PENDING_APPROVAL",
      actionProposed: JSON.stringify(descriptor),
      impactClass: opts.option.impactClass === "HIGH" ? "HIGH" : opts.option.impactClass === "MEDIUM" ? "MEDIUM" : "LOW",
      riskExplanation: opts.rationale,
      requestId: opts.correlation.requestId,
      correlationId: opts.correlation.correlationId,
    });

    // Durably record escalation in SQLite
    await this.stateStore.createEscalation(record);

    // Notify user via IEscalationPort boundary if available
    if (this.escalationPort) {
      await this.escalationPort.requestApproval({
        id: record.id,
        action: opts.option.intent,
        impactClass: record.impactClass,
        riskExplanation: opts.rationale,
        correlation: opts.correlation,
      });
    }

    return record;
  }

  /**
   * Validates an existing human approval gate against the current context and policy version.
   * Invalidates approval if state or policy became stale.
   */
  async validateApproval(
    escalationId: string,
    currentContext: OperationalContext,
    currentPolicy: PolicyEnvelope,
  ): Promise<{
    valid: boolean;
    status: DecisionApprovalState;
    reason?: string;
    descriptor?: ApprovalGateDescriptor;
  }> {
    const escalation = await this.stateStore.getEscalation(escalationId);
    if (!escalation) {
      return {
        valid: false,
        status: "REJECTED",
        reason: `Escalation '${escalationId}' not found.`,
      };
    }

    let descriptor: ApprovalGateDescriptor | null = null;
    try {
      descriptor = JSON.parse(escalation.actionProposed) as ApprovalGateDescriptor;
    } catch {
      // If legacy format without descriptor JSON
    }

    // Check expiration
    if (descriptor && descriptor.expiresAt) {
      if (Date.now() > Date.parse(descriptor.expiresAt)) {
        await this.stateStore.resolveEscalation(
          escalationId,
          "EXPIRED",
          "Approval TTL exceeded without resolution.",
        );
        return {
          valid: false,
          status: "EXPIRED",
          reason: "Human approval TTL exceeded.",
          descriptor,
        };
      }
    }

    // Check Context Version Staleness
    if (descriptor && currentContext.version !== descriptor.contextVersion) {
      await this.stateStore.resolveEscalation(
        escalationId,
        "CANCELLED",
        `State version advanced mid-turn (expected v${descriptor.contextVersion}, current v${currentContext.version}).`,
      );
      return {
        valid: false,
        status: "STALE",
        reason: `State version advanced mid-turn (expected v${descriptor.contextVersion}, current v${currentContext.version}).`,
        descriptor,
      };
    }

    // Check Policy Version Staleness
    const currentPolicyVersion = currentPolicy.policyVersion ?? "1.0.0";
    if (descriptor && descriptor.policyVersion !== currentPolicyVersion) {
      await this.stateStore.resolveEscalation(
        escalationId,
        "CANCELLED",
        `Policy version changed (expected v${descriptor.policyVersion}, current v${currentPolicyVersion}).`,
      );
      return {
        valid: false,
        status: "STALE",
        reason: `Policy envelope modified during approval window.`,
        descriptor,
      };
    }

    if (escalation.status === "APPROVED") {
      return {
        valid: true,
        status: "APPROVED",
        descriptor: descriptor ?? undefined,
      };
    }

    if (escalation.status === "REJECTED") {
      return {
        valid: false,
        status: "REJECTED",
        reason: escalation.resolutionComment ?? "Human explicitly rejected action.",
        descriptor: descriptor ?? undefined,
      };
    }

    if (escalation.status === "EXPIRED") {
      return {
        valid: false,
        status: "EXPIRED",
        reason: "Approval expired.",
        descriptor: descriptor ?? undefined,
      };
    }

    return {
      valid: false,
      status: "WAITING_FOR_HUMAN",
      reason: "Approval gate awaiting human confirmation.",
      descriptor: descriptor ?? undefined,
    };
  }
}
