import { CorrelationMetadata } from "../../../contracts/results/result";
import { createStimulus, CognitiveStimulus } from "../../types/stimulus";
import { DiscoveryPayload, IIngressAdapter, IVajraStimulusIngressCoordinator } from "../types";

export interface InsightLike {
  id: string;
  canonicalKey: string;
  category: string;
  confidence: string | number;
  supportingUnderstandingIds: string[];
  updatedAt?: string;
  createdAt?: string;
}

export type InsightSubscriber = (listener: (insights: InsightLike[]) => void) => () => void;

export class GenesisDiscoveryIngressAdapter implements IIngressAdapter {
  readonly name = "genesis-discovery-ingress";
  private unsubscribe: (() => void) | null = null;
  // Tracks active insight ID -> latest observed signature
  private readonly activeSignatures = new Map<string, string>();
  private isSeeded = false;

  constructor(
    private readonly coordinator: IVajraStimulusIngressCoordinator,
    private readonly subscribeFn: InsightSubscriber,
  ) {}

  isAttached(): boolean {
    return this.unsubscribe !== null;
  }

  attach(): void {
    if (this.unsubscribe) {
      return;
    }

    this.isSeeded = false;

    this.unsubscribe = this.subscribeFn((insights: InsightLike[]) => {
      this.handleInsightsUpdate(insights);
    });
  }

  detach(): void {
    if (this.unsubscribe) {
      try {
        this.unsubscribe();
      } catch (err) {
        console.warn("[GenesisDiscoveryIngressAdapter] Error during unsubscribe:", err);
      }
      this.unsubscribe = null;
    }
    this.activeSignatures.clear();
    this.isSeeded = false;
  }

  private handleInsightsUpdate(insights: InsightLike[]): void {
    if (!Array.isArray(insights)) {
      return;
    }

    // On initial attach, insightEngine immediately emits existing state.
    // We seed existing insight signatures so baseline history does not flood VAJRA as new discoveries.
    if (!this.isSeeded) {
      for (const ins of insights) {
        if (ins && ins.id && typeof ins.id === "string") {
          const sig = this.computeSignature(ins);
          this.activeSignatures.set(ins.id, sig);
        }
      }
      this.isSeeded = true;
      return;
    }

    const currentInsightIds = new Set<string>();

    // Process new or changed insights
    for (const ins of insights) {
      if (!ins || !ins.id || typeof ins.id !== "string" || !ins.canonicalKey) {
        continue;
      }

      currentInsightIds.add(ins.id);
      const signature = this.computeSignature(ins);
      const previousSignature = this.activeSignatures.get(ins.id);

      if (previousSignature === signature) {
        // Unchanged insight; suppress duplicate submission
        continue;
      }

      // Record updated signature for this insight ID
      this.activeSignatures.set(ins.id, signature);

      // Package into CognitiveStimulus (kind: "subsystem_discovery")
      const uid =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : Math.random().toString(36).slice(2) + Date.now().toString(36);

      const correlation: CorrelationMetadata = {
        requestId: `req-disc-${ins.id}-${uid}`,
        correlationId: `corr-disc-${ins.id}`,
        invocationId: `inv-disc-${uid}`,
      };

      const payload: DiscoveryPayload = Object.freeze({
        insightId: ins.id,
        canonicalKey: ins.canonicalKey,
        category: String(ins.category),
        confidence: ins.confidence,
        supportingUnderstandingIds: Object.freeze([...(ins.supportingUnderstandingIds || [])]),
      });

      const stimulus: CognitiveStimulus<DiscoveryPayload> = createStimulus({
        id: `stim-disc-${ins.id}-${uid}`,
        kind: "subsystem_discovery",
        source: "genesis.insight_engine",
        payload,
        correlation,
      });

      // Submit asynchronously to coordinator
      this.coordinator.submitStimulus(stimulus).catch((err) => {
        console.warn(
          `[GenesisDiscoveryIngressAdapter] Failed to submit discovery stimulus for '${ins.id}':`,
          err,
        );
      });
    }

    // Prune entries for insights removed from the graph to keep memory bounded to the active graph
    for (const trackedId of this.activeSignatures.keys()) {
      if (!currentInsightIds.has(trackedId)) {
        this.activeSignatures.delete(trackedId);
      }
    }
  }

  private computeSignature(ins: InsightLike): string {
    const key = ins.canonicalKey || ins.id;
    const conf = ins.confidence ?? "unknown";
    const updated = ins.updatedAt || ins.createdAt || "";
    return `${ins.id}::${key}::${conf}::${updated}`;
  }
}
