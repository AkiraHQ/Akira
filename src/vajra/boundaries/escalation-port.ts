import { CorrelationMetadata } from "../../contracts/results/result";
import { ImpactClass } from "../types/policy";

/**
 * Structured request for human escalation and authorization.
 */
export interface EscalationRequest {
  readonly id: string;
  readonly action: string;
  readonly impactClass: ImpactClass;
  readonly riskExplanation: string;
  readonly correlation: CorrelationMetadata;
}

/**
 * Human resolution payload for an escalation request.
 */
export interface EscalationResponse {
  readonly approved: boolean;
  readonly humanComment?: string;
  readonly resolvedAt: string;
}

/**
 * Typed port interface for human escalation and notifications.
 */
export interface IEscalationPort {
  requestApproval(request: EscalationRequest): Promise<EscalationResponse>;
  notify(message: string, level: "info" | "warning"): void;
}

/**
 * In-memory adapter for testing escalation pathways.
 */
export class InMemoryEscalationAdapter implements IEscalationPort {
  private autoApprove: boolean = false;
  private pendingRequests: EscalationRequest[] = [];
  private notifications: { message: string; level: "info" | "warning" }[] = [];

  setAutoApprove(val: boolean): void {
    this.autoApprove = val;
  }

  getPendingRequests(): readonly EscalationRequest[] {
    return Object.freeze([...this.pendingRequests]);
  }

  getNotifications(): readonly { message: string; level: "info" | "warning" }[] {
    return Object.freeze([...this.notifications]);
  }

  async requestApproval(request: EscalationRequest): Promise<EscalationResponse> {
    this.pendingRequests.push(request);
    return {
      approved: this.autoApprove,
      humanComment: this.autoApprove ? "Approved automatically by test adapter" : "Rejected by default in test adapter",
      resolvedAt: new Date().toISOString(),
    };
  }

  notify(message: string, level: "info" | "warning"): void {
    this.notifications.push({ message, level });
  }
}
