import { Result, CorrelationMetadata } from "../../contracts/results/result";

/**
 * User traits and profiling observations provided by GENESIS.
 */
export interface UserIdentityTraits {
  readonly technicalBackground?: string;
  readonly preferredTone?: string;
  readonly traits: Readonly<Record<string, unknown>>;
}

/**
 * Historical memory item returned by GENESIS recall.
 */
export interface HistoricalMemoryItem {
  readonly id: string;
  readonly content: string;
  readonly relevance: number;
}

/**
 * Structured response from GENESIS memory recall.
 */
export interface HistoricalMemoryResult {
  readonly memories: readonly HistoricalMemoryItem[];
}

/**
 * Typed port interface for communication between VAJRA and GENESIS.
 *
 * INVARIANTS:
 * - VAJRA queries GENESIS for memory and identity intelligence.
 * - GENESIS never executes side-effect commands or mutates global operational missions.
 */
export interface IGenesisPort {
  recallMemories(
    query: string,
    correlation: CorrelationMetadata,
  ): Promise<Result<HistoricalMemoryResult, string>>;

  getIdentityTraits(
    correlation: CorrelationMetadata,
  ): Promise<Result<UserIdentityTraits, string>>;

  subscribeToCognitiveDiscoveries(listener: (event: unknown) => void): () => void;
}

/**
 * In-memory adapter for unit tests and offline testing.
 */
export class InMemoryGenesisAdapter implements IGenesisPort {
  private memories: HistoricalMemoryItem[] = [];
  private traits: UserIdentityTraits = {
    technicalBackground: "systems_engineering",
    preferredTone: "concise",
    traits: {},
  };
  private discoveryListeners: Set<(event: unknown) => void> = new Set();

  setMemories(items: HistoricalMemoryItem[]): void {
    this.memories = [...items];
  }

  setTraits(traits: UserIdentityTraits): void {
    this.traits = { ...traits };
  }

  emitDiscovery(event: unknown): void {
    for (const listener of this.discoveryListeners) {
      listener(event);
    }
  }

  async recallMemories(
    query: string,
    correlation: CorrelationMetadata,
  ): Promise<Result<HistoricalMemoryResult, string>> {
    const qLower = query.toLowerCase();
    const matched = this.memories.filter((m) => m.content.toLowerCase().includes(qLower));
    return Result.success({ memories: Object.freeze(matched) }, correlation);
  }

  async getIdentityTraits(
    correlation: CorrelationMetadata,
  ): Promise<Result<UserIdentityTraits, string>> {
    return Result.success(this.traits, correlation);
  }

  subscribeToCognitiveDiscoveries(listener: (event: unknown) => void): () => void {
    this.discoveryListeners.add(listener);
    return () => {
      this.discoveryListeners.delete(listener);
    };
  }
}

/**
 * Live adapter connecting to GENESIS core cognitive services.
 */
export class LiveGenesisAdapter implements IGenesisPort {
  private discoveryListeners: Set<(event: unknown) => void> = new Set();

  constructor(
    private memoryService?: { search?: (q: string) => Promise<any[]> },
    private identityService?: { getTraits?: () => Promise<any> },
  ) {}

  async recallMemories(
    query: string,
    correlation: CorrelationMetadata,
  ): Promise<Result<HistoricalMemoryResult, string>> {
    try {
      if (this.memoryService?.search) {
        const raw = await this.memoryService.search(query);
        const mapped: HistoricalMemoryItem[] = (raw || []).map((m: any, idx: number) => ({
          id: m.id ?? `mem-${idx}`,
          content: m.content ?? String(m),
          relevance: m.relevance ?? 1.0,
        }));
        return Result.success({ memories: Object.freeze(mapped) }, correlation);
      }
      return Result.success({ memories: Object.freeze([]) }, correlation);
    } catch (err: any) {
      return Result.failure(`Failed to recall memories from GENESIS: ${err?.message ?? String(err)}`, correlation);
    }
  }

  async getIdentityTraits(
    correlation: CorrelationMetadata,
  ): Promise<Result<UserIdentityTraits, string>> {
    try {
      if (this.identityService?.getTraits) {
        const raw = await this.identityService.getTraits();
        return Result.success(
          {
            technicalBackground: raw?.technicalBackground,
            preferredTone: raw?.preferredTone,
            traits: Object.freeze(raw?.traits ?? {}),
          },
          correlation,
        );
      }
      return Result.success(
        {
          traits: Object.freeze({}),
        },
        correlation,
      );
    } catch (err: any) {
      return Result.failure(`Failed to fetch identity traits from GENESIS: ${err?.message ?? String(err)}`, correlation);
    }
  }

  subscribeToCognitiveDiscoveries(listener: (event: unknown) => void): () => void {
    this.discoveryListeners.add(listener);
    return () => {
      this.discoveryListeners.delete(listener);
    };
  }
}
