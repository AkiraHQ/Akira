/**
 * AKIRA OS Capability Integration Host
 *
 * ARCHITECTURAL CONTEXT & BOUNDARY (Phase 3F):
 * This module provides the canonical application-level CapabilityRegistry host for AKIRA OS.
 *
 * CRITICAL ARCHITECTURAL CONSTRAINTS (Phase 3F/3G Gate):
 * 1. O1 PRESERVATION: This host lives in the AKIRA OS domain/platform layer and attaches
 *    to the current Node/server execution environment where SQLite runs today.
 *    It does NOT resolve or settle Open Decision O1 (Authoritative Live Runtime Placement).
 *    When O1 is eventually resolved, this host can be relocated behind IPC, Tauri commands,
 *    or a dedicated runtime boundary without altering callers.
 * 2. GROUNDED CAPABILITIES: Registers task.create (Phase 3F), task.read (Phase 3G),
 *    task.update (Phase 3H), recall.search (Phase 3J, Tier 2), and task.list (Phase 3K).
 *    `project.read` and `project.list` deliberately remain unintegrated for this slice.
 * 3. NO SECOND RUNTIME MANAGER: This is not a process supervisor, scheduler, or worker pool.
 *    It is purely a typed singleton host of the Contract K8/K9 CapabilityRegistry.
 */

import { CapabilityRegistry } from "../../contracts/capabilities/registry";
import {
  taskCreateDescriptor,
  taskCreateHandler,
  taskUpdateDescriptor,
  taskUpdateHandler,
} from "../tasks/capabilities/task-write";
import {
  taskReadDescriptor,
  taskReadHandler,
  taskListDescriptor,
  taskListHandler,
} from "../tasks/capabilities/task-read";
import {
  recallSearchDescriptor,
  recallSearchHandler,
} from "../search/capabilities/recall-search";

let canonicalRegistry: CapabilityRegistry | null = null;

/**
 * Creates and initializes the canonical AKIRA OS CapabilityRegistry.
 * Wires task.create (Phase 3F), task.read (Phase 3G), task.update (Phase 3H),
 * recall.search (Phase 3J, Tier 2), and task.list (Phase 3K).
 */
export function createCanonicalRegistry(): CapabilityRegistry {
  const registry = new CapabilityRegistry();
  registry.register(taskCreateDescriptor, taskCreateHandler);
  registry.register(taskReadDescriptor, taskReadHandler);
  registry.register(taskUpdateDescriptor, taskUpdateHandler);
  registry.register(recallSearchDescriptor, recallSearchHandler);
  registry.register(taskListDescriptor, taskListHandler);
  return registry;
}

/**
 * Accessor for the canonical AKIRA OS CapabilityRegistry.
 * Initializes lazily on first access and guarantees a single shared registry instance.
 */
export function getCapabilityRegistry(): CapabilityRegistry {
  if (!canonicalRegistry) {
    canonicalRegistry = createCanonicalRegistry();
  }
  return canonicalRegistry;
}

/**
 * Reset helper for testing environments to ensure clean test isolation.
 */
export function resetCapabilityRegistry(): void {
  canonicalRegistry = null;
}
