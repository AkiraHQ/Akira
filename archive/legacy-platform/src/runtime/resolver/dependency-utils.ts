import { ModuleManifest } from "../manifest";
import { DependencyResolver } from "./dependency-resolver";

export interface LoadableAnalysis {
  loadableManifests: ModuleManifest[];
  skippedModules: { id: string; reason: string }[];
  startupOrder: string[];
}

/**
 * Transitively isolates and skips modules affected by circular or missing dependencies,
 * providing a load plan for the remaining independent modules.
 */
export function analyzeDependencies(manifests: ModuleManifest[]): LoadableAnalysis {
  const resolver = new DependencyResolver(manifests);
  const graph = resolver.buildGraph();

  const missing = resolver.findMissingDependencies();
  const cycle = resolver.findCircularDependencies();

  const skipped = new Map<string, string>(); // moduleId -> skip reason

  // 1. Mark directly missing dependency nodes
  for (const item of missing) {
    skipped.set(item.moduleId, `Missing dependency: "${item.missingId}"`);
  }

  // 2. Mark directly circular nodes
  if (cycle) {
    const cycleStr = cycle.join(" -> ");
    for (const id of cycle) {
      skipped.set(id, `Part of a circular dependency path: ${cycleStr}`);
    }
  }

  // 3. Transitively skip all dependents of skipped modules
  let newlySkipped = true;
  while (newlySkipped) {
    newlySkipped = false;
    for (const node of graph.nodes.values()) {
      if (skipped.has(node.moduleId)) {
        continue;
      }
      for (const depId of node.dependencies) {
        if (skipped.has(depId) || !graph.nodes.has(depId)) {
          skipped.set(node.moduleId, `Transitive dependency "${depId}" is unavailable or skipped`);
          newlySkipped = true;
          break;
        }
      }
    }
  }

  // 4. Construct a sub-manifest list of only loadable modules
  const loadableManifests = manifests.filter((m) => !skipped.has(m.id));

  // 5. Generate topological sorted order for only loadable elements
  let startupOrder: string[] = [];
  if (loadableManifests.length > 0) {
    const safeResolver = new DependencyResolver(loadableManifests);
    startupOrder = safeResolver.getStartupOrder();
  }

  const skippedModules = Array.from(skipped.entries())
    .map(([id, reason]) => ({ id, reason }))
    .sort((a, b) => a.id.localeCompare(b.id));

  return {
    loadableManifests,
    skippedModules,
    startupOrder,
  };
}
