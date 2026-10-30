import { createServerFn } from "@tanstack/react-start";
import type { ChatConversation } from "../../../shared/types/store-types";
import type {
  HistoricalEvidence,
  HistoricalSearchRequest,
} from "../../../contracts/historical-recall";

export const persistSaveConversations = createServerFn({ method: "POST" })
  .validator((conversations: ChatConversation[]) => conversations)
  .handler(async ({ data: conversations }) => {
    const { conversationRepository } = await import("../../../persistence/repositories");
    conversationRepository.save(conversations);
  });

export async function searchRecallViaCapability(
  request: HistoricalSearchRequest,
): Promise<HistoricalEvidence[]> {
  const { getCapabilityRegistry } = await import("../../capabilities/host");
  const registry = getCapabilityRegistry();

  const corrId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);

  const correlation = {
    requestId: `req_${corrId}`,
    correlationId: `corr_${corrId}`,
    invocationId: `inv_${corrId}`,
  };

  const result = await registry.invoke<
    {
      terms: string[];
      limit?: number;
      excludeConversationId?: string;
    },
    HistoricalEvidence[]
  >(
    "recall.search",
    {
      terms: request.terms,
      limit: request.limit,
      excludeConversationId: request.excludeConversationId,
    },
    correlation,
    { isInternal: true, isVajra: false },
  );

  if (!result.ok) {
    throw new Error(`Failed to search historical recall via capability: ${result.error.message}`);
  }

  return result.value;
}

export const querySearchMessages = createServerFn({ method: "POST" })
  .validator((request: HistoricalSearchRequest) => request)
  .handler(async ({ data: request }): Promise<HistoricalEvidence[]> => {
    return searchRecallViaCapability(request);
  });

