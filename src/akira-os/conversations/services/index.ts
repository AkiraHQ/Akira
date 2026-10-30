import type { ChatConversation } from "../../../shared/types/store-types";
import {
  registerHistoricalRecallProvider,
  type HistoricalRecallProvider,
} from "../../../contracts/historical-recall";
import { runInServerRuntime } from "../../../persistence/akira-store";
import { persistSaveConversations, querySearchMessages } from "../server";

export const conversationsService = {
  /**
   * The only write path for the chat archive. Writes the `settings` blob the
   * chat UI reads and its `conversations` / `chat_messages` mirror together,
   * so the two cannot drift. Reads stay on the blob.
   */
  async save(conversations: ChatConversation[]): Promise<void> {
    await runInServerRuntime(() => persistSaveConversations({ data: conversations }));
  },
};

/**
 * AKIRA OS's side of the Historical Recall contract: keyword search over the
 * `chat_messages` mirror, reached over RPC from the browser. GENESIS holds only
 * the contract, never this module.
 */
export const historicalRecall: HistoricalRecallProvider = {
  search: async (request) => {
    if (typeof window === "undefined") {
      const { searchRecallViaCapability } = await import("../server");
      return searchRecallViaCapability(request);
    }
    return runInServerRuntime(() => querySearchMessages({ data: request }));
  },
};

registerHistoricalRecallProvider(historicalRecall);
