import { z } from "zod";
import { CapabilityDescriptor } from "../../../contracts/capabilities/descriptor";
import { CapabilityRegistry, CapabilityLifecycleHooks } from "../../../contracts/capabilities/registry";
import type { HistoricalEvidence } from "../../../contracts/historical-recall";

/**
 * Input Schema for recall.search Tier-2 capability per Contract K11.
 */
export const recallSearchInputSchema = z.object({
  terms: z.array(z.string().min(1, "Term must be a non-empty string")).min(1, "At least one search term is required"),
  limit: z.number().int().positive().optional().default(10),
  excludeConversationId: z.string().optional(),
});

export type RecallSearchInput = z.infer<typeof recallSearchInputSchema>;

/**
 * Descriptor for recall.search Query capability per Contract K7 / Contract K11 / Contract K22.
 * Owner: AKIRA OS · search
 * Activation Tier: Tier 2 (On-Demand Capability per Contract K22 / Rule N2)
 */
export const recallSearchDescriptor: CapabilityDescriptor<RecallSearchInput, HistoricalEvidence[]> = {
  name: "recall.search",
  version: "1.0.0",
  owner: "AKIRA OS · search",
  kind: "Query",
  inputSchema: recallSearchInputSchema as unknown as z.ZodType<RecallSearchInput>,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: true,
  },
  activationTier: 2,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: true,
  },
};

/**
 * Handler for recall.search capability.
 * Adapts existing SqliteConversationRepository keyword search without modifying repository internals.
 */
export async function recallSearchHandler(
  input: RecallSearchInput,
): Promise<HistoricalEvidence[]> {
  const { conversationRepository } = await import("../../../persistence/repositories");
  return conversationRepository.searchMessages({
    terms: input.terms,
    limit: input.limit,
    excludeConversationId: input.excludeConversationId,
  });
}

/**
 * Helper to register recall.search Tier 2 capability in the AKIRA OS Capability Registry.
 */
export function registerRecallSearchCapability(
  registry: CapabilityRegistry,
  hooks?: CapabilityLifecycleHooks,
): void {
  registry.register(recallSearchDescriptor, recallSearchHandler, hooks);
}
