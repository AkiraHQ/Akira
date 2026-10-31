import { CorrelationMetadata } from "../../contracts/results/result";
import { ImpactClass } from "../types/policy";
import {
  VajraEscalationRecord,
  EscalationStatus,
  createVajraEscalationRecord,
} from "../types/escalation-record";
import { IOperationalStateStore } from "../ports/state-store";
import { SqliteOperationalStateStore } from "../../persistence/vajra/sqlite-operational-state-store";
import { publish } from "../../instrumentation/publisher";

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
 * Options for configuring the live escalation adapter.
 */
export interface LiveEscalationAdapterOptions {
  readonly stateStore?: IOperationalStateStore;
  readonly eventPublisher?: { publish: (event: any) => void };
}

/**
 * Authoritative production adapter for human escalation and authorization gates.
 *
 * Persists escalation requests into the durable `vajra_escalations` store
 * with status `PENDING_APPROVAL`, propagates events over the platform instrumentation
 * publisher, and supports external resolution lookup and approval/rejection resolution.
 */
export class LiveEscalationAdapter implements IEscalationPort {
  private readonly stateStore: IOperationalStateStore;
  private readonly eventPublisher?: { publish: (event: any) => void };

  constructor(
    storeOrOptions?: IOperationalStateStore | LiveEscalationAdapterOptions,
    eventPublisher?: { publish: (event: any) => void },
  ) {
    if (storeOrOptions && "createEscalation" in storeOrOptions) {
      this.stateStore = storeOrOptions;
      this.eventPublisher = eventPublisher ?? { publish };
    } else {
      const opts = storeOrOptions as LiveEscalationAdapterOptions | undefined;
      this.stateStore = opts?.stateStore ?? new SqliteOperationalStateStore();
      this.eventPublisher = opts?.eventPublisher ?? eventPublisher ?? { publish };
    }
  }

  /**
   * Records or checks an escalation request in the durable operational state store.
   * If already resolved (APPROVED/REJECTED), returns the existing resolution.
   * If pending or newly inserted, persists with PENDING_APPROVAL and returns non-approved pending status.
   */
  async requestApproval(request: EscalationRequest): Promise<EscalationResponse> {
    const now = new Date().toISOString();

    try {
      const existing = await this.stateStore.getEscalation(request.id);

      if (existing) {
        if (existing.status === "APPROVED") {
          return {
            approved: true,
            humanComment: existing.resolutionComment ?? undefined,
            resolvedAt: existing.resolvedAt ?? now,
          };
        }
        if (existing.status === "REJECTED") {
          return {
            approved: false,
            humanComment: existing.resolutionComment ?? undefined,
            resolvedAt: existing.resolvedAt ?? now,
          };
        }
      } else {
        const record = createVajraEscalationRecord({
          id: request.id,
          status: "PENDING_APPROVAL",
          actionProposed: request.action,
          impactClass: request.impactClass,
          riskExplanation: request.riskExplanation,
          requestId: request.correlation.requestId,
          correlationId: request.correlation.correlationId,
          createdAt: now,
        });

        await this.stateStore.createEscalation(record);
      }

      // Publish request event if event publisher is attached
      if (this.eventPublisher) {
        try {
          this.eventPublisher.publish({
            id: `esc-req-${request.id}`,
            type: "vajra.escalation.requested",
            timestamp: now,
            source: "vajra.escalation",
            correlationId: request.correlation.correlationId,
            payload: {
              id: request.id,
              action: request.action,
              impactClass: request.impactClass,
              riskExplanation: request.riskExplanation,
            },
            version: "1.0.0",
          });
        } catch (eventErr) {
          console.warn("[LiveEscalationAdapter] Failed to publish escalation request event:", eventErr);
        }
      }

      return {
        approved: false,
        humanComment: "Pending human approval gate in vajra_escalations",
        resolvedAt: now,
      };
    } catch (err: any) {
      console.error(`[LiveEscalationAdapter] Failed to persist escalation request '${request.id}':`, err);
      throw new Error(`Failed to persist escalation request '${request.id}' to SQLite: ${err?.message ?? String(err)}`);
    }
  }

  /**
   * External resolution hook: approves or rejects a pending escalation record.
   */
  async resolve(id: string, approved: boolean, humanComment?: string): Promise<void> {
    const status: EscalationStatus = approved ? "APPROVED" : "REJECTED";
    const now = new Date().toISOString();

    try {
      await this.stateStore.resolveEscalation(id, status, humanComment ?? null, now);

      if (this.eventPublisher) {
        try {
          this.eventPublisher.publish({
            id: `esc-res-${id}`,
            type: "vajra.escalation.resolved",
            timestamp: now,
            source: "vajra.escalation",
            payload: { id, status, humanComment },
            version: "1.0.0",
          });
        } catch (eventErr) {
          console.warn("[LiveEscalationAdapter] Failed to publish escalation resolution event:", eventErr);
        }
      }
    } catch (err: any) {
      console.error(`[LiveEscalationAdapter] Failed to resolve escalation '${id}':`, err);
      throw err;
    }
  }

  /**
   * Retrieves a durable escalation record by ID.
   */
  async getEscalation(id: string): Promise<VajraEscalationRecord | null> {
    try {
      return await this.stateStore.getEscalation(id);
    } catch (err: any) {
      console.error(`[LiveEscalationAdapter] Failed to retrieve escalation '${id}':`, err);
      throw err;
    }
  }

  /**
   * Retrieves all currently pending escalation records.
   */
  async getPendingEscalations(): Promise<readonly VajraEscalationRecord[]> {
    try {
      return await this.stateStore.getPendingEscalations();
    } catch (err: any) {
      console.error("[LiveEscalationAdapter] Failed to retrieve pending escalations:", err);
      throw err;
    }
  }

  /**
   * Dispatches human/operational notifications across the platform event publisher and console logger.
   */
  notify(message: string, level: "info" | "warning"): void {
    if (this.eventPublisher) {
      try {
        this.eventPublisher.publish({
          id: `esc-notify-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
          type: "vajra.escalation.notification",
          timestamp: new Date().toISOString(),
          source: "vajra.escalation",
          payload: { message, level },
          version: "1.0.0",
          transient: true,
        });
      } catch (err) {
        console.warn("[LiveEscalationAdapter] Failed to publish notification to event bus:", err);
      }
    }

    if (level === "warning") {
      console.warn(`[VAJRA ESCALATION WARNING] ${message}`);
    } else {
      console.info(`[VAJRA ESCALATION INFO] ${message}`);
    }
  }
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
