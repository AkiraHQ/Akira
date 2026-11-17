export interface MemoryEntity {
  id: string;
  concept: string;
  salience: number;
  tags: string[];
}

/**
 * Validated Genesis memory consolidation prompt parser.
 * Handles multiline LLM outputs with markdown tags, JSON blocks, and fallback text sections.
 */
export function parseConsolidatedMemoryOutput(rawOutput: string): MemoryEntity[] {
  if (!rawOutput || typeof rawOutput !== "string") {
    return [];
  }

  const results: MemoryEntity[] = [];
  const lines = rawOutput.split(/\r?\n/);
  let inEntityBlock = false;
  let currentEntity: Partial<MemoryEntity> = {};

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("### ENTITY:")) {
      if (currentEntity.concept && currentEntity.salience !== undefined) {
        results.push({
          id: currentEntity.id || `mem_${Date.now()}_${results.length}`,
          concept: currentEntity.concept,
          salience: currentEntity.salience,
          tags: currentEntity.tags || [],
        });
      }
      inEntityBlock = true;
      currentEntity = { concept: trimmed.replace("### ENTITY:", "").trim(), tags: [] };
    } else if (inEntityBlock && trimmed.startsWith("SALIENCE:")) {
      const val = parseFloat(trimmed.replace("SALIENCE:", "").trim());
      currentEntity.salience = isNaN(val) ? 0.5 : Math.max(0, Math.min(1, val));
    } else if (inEntityBlock && trimmed.startsWith("TAGS:")) {
      currentEntity.tags = trimmed
        .replace("TAGS:", "")
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
    }
  }

  if (currentEntity.concept && currentEntity.salience !== undefined) {
    results.push({
      id: currentEntity.id || `mem_${Date.now()}_${results.length}`,
      concept: currentEntity.concept,
      salience: currentEntity.salience,
      tags: currentEntity.tags || [],
    });
  }

  return results;
}
