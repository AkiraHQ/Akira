import { Result } from "../../contracts/results/result";
import { ExecutiveAction } from "../types/action";
import { CognitiveStimulus, StimulusKind } from "../types/stimulus";
import { ExecutiveController } from "../executive/controller";
import { IngressCoordinatorOptions, IVajraStimulusIngressCoordinator } from "./types";

const VALID_STIMULUS_KINDS = new Set<StimulusKind>([
  "human_prompt",
  "system_event",
  "subsystem_discovery",
  "scheduled_timer",
  "step_result",
]);

const DEFAULT_SEEN_LIMIT = 5000;
const DEFAULT_MAX_PENDING_TURNS = 50;

export class VajraStimulusIngressCoordinator implements IVajraStimulusIngressCoordinator {
  private readonly seenIds = new Set<string>();
  private readonly seenOrder: string[] = [];
  private readonly seenCacheLimit: number;
  private readonly maxPendingBackgroundTurns: number;
  private attached = false;
  private activeController: ExecutiveController | null = null;

  constructor(
    private readonly controllerResolver: () => Promise<ExecutiveController>,
    options?: IngressCoordinatorOptions,
  ) {
    this.seenCacheLimit = options?.seenCacheLimit ?? DEFAULT_SEEN_LIMIT;
    this.maxPendingBackgroundTurns =
      options?.maxPendingBackgroundTurns ?? DEFAULT_MAX_PENDING_TURNS;
  }

  isAttached(): boolean {
    return this.attached;
  }

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
    this.seenIds.clear();
    this.seenOrder.length = 0;
    this.activeController = null;
  }

  getPendingTurnsCount(): number {
    return this.activeController &&
      typeof (this.activeController as any).getPendingTurnsCount === "function"
      ? (this.activeController as any).getPendingTurnsCount()
      : 0;
  }

  isCongested(): boolean {
    return this.getPendingTurnsCount() >= this.maxPendingBackgroundTurns;
  }

  async submitStimulus<TPayload = unknown>(
    stimulus: CognitiveStimulus<TPayload>,
  ): Promise<Result<ExecutiveAction, string>> {
    if (!this.attached) {
      return Result.failure(
        "VAJRA Ingress Coordinator is not attached or server is shutting down.",
        stimulus.correlation,
      );
    }

    // 1. Structural Invariant Verification
    const validationError = this.validateStimulus(stimulus);
    if (validationError) {
      return Result.failure(validationError, stimulus.correlation);
    }

    // 2. In-Memory Bounded Deduplication
    if (this.seenIds.has(stimulus.id)) {
      return Result.failure(
        `Duplicate stimulus rejected: '${stimulus.id}' has already been submitted.`,
        stimulus.correlation,
      );
    }

    this.recordSeenId(stimulus.id);

    // 3. Resolve Operational Controller
    let controller: ExecutiveController;
    try {
      controller = await this.controllerResolver();
      this.activeController = controller;
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      return Result.failure(
        `VAJRA runtime is not operationally ready: ${msg}`,
        stimulus.correlation,
      );
    }

    if (controller.getState() !== "RUNNING") {
      return Result.failure(
        `VAJRA controller is not RUNNING (current state: '${controller.getState()}').`,
        stimulus.correlation,
      );
    }

    // 4. Backpressure Check for Background Events
    if (stimulus.kind !== "human_prompt") {
      const pendingTurns = this.getPendingTurnsCount();
      if (pendingTurns >= this.maxPendingBackgroundTurns) {
        console.warn(
          `[IngressCoordinator] Dropping background stimulus '${stimulus.id}' (kind: '${stimulus.kind}', source: '${stimulus.source}') due to congestion (${pendingTurns} pending turns).`,
        );
        return Result.failure(
          `Background stimulus dropped: ingress queue is congested (${pendingTurns} pending turns).`,
          stimulus.correlation,
        );
      }
    }

    // 5. Submit into Authoritative Deliberation Pipeline
    return controller.receiveStimulus(stimulus);
  }

  private validateStimulus(stimulus: CognitiveStimulus<unknown>): string | null {
    if (!stimulus || typeof stimulus !== "object") {
      return "Stimulus payload must be a non-null object.";
    }

    if (!stimulus.id || typeof stimulus.id !== "string" || !stimulus.id.trim()) {
      return "Stimulus must carry a non-empty string 'id'.";
    }

    if (!VALID_STIMULUS_KINDS.has(stimulus.kind)) {
      return `Unsupported stimulus kind '${stimulus.kind}'.`;
    }

    if (!stimulus.source || typeof stimulus.source !== "string" || !stimulus.source.trim()) {
      return "Stimulus must carry a non-empty string 'source'.";
    }

    if (
      !stimulus.timestamp ||
      typeof stimulus.timestamp !== "string" ||
      Number.isNaN(Date.parse(stimulus.timestamp))
    ) {
      return "Stimulus must carry a valid ISO-8601 'timestamp'.";
    }

    const corr = stimulus.correlation;
    if (
      !corr ||
      typeof corr !== "object" ||
      !corr.requestId ||
      !corr.correlationId ||
      !corr.invocationId
    ) {
      return "Stimulus is missing required CorrelationMetadata (requestId, correlationId, invocationId).";
    }

    return null;
  }

  private recordSeenId(id: string): void {
    this.seenIds.add(id);
    this.seenOrder.push(id);

    if (this.seenOrder.length > this.seenCacheLimit) {
      const oldest = this.seenOrder.shift();
      if (oldest) {
        this.seenIds.delete(oldest);
      }
    }
  }
}
