import { DependencyNode } from "./dependency-node";
import { ModuleManifest } from "../manifest";
import {
  DuplicateDependencyError,
  SelfDependencyError,
  InvalidDependencyError,
} from "./dependency-errors";

export class DependencyGraph {
  public nodes = new Map<string, DependencyNode>();

  /**
   * Adds a module node to the graph and validates its local manifest declarations.
   */
  public addNode(moduleId: string, manifest: ModuleManifest): void {
    if (this.nodes.has(moduleId)) {
      return;
    }

    const seenDeps = new Set<string>();
    const dependencyIds = manifest.dependencies || [];

    for (const depId of dependencyIds) {
      if (!depId || typeof depId !== "string" || depId.trim() === "") {
        throw new InvalidDependencyError(
          moduleId,
          depId,
          "Dependency identifier must be a non-empty string",
        );
      }

      const trimmedDepId = depId.trim();

      if (trimmedDepId === moduleId) {
        throw new SelfDependencyError(moduleId);
      }

      if (seenDeps.has(trimmedDepId)) {
        throw new DuplicateDependencyError(moduleId, trimmedDepId);
      }
      seenDeps.add(trimmedDepId);
    }

    this.nodes.set(moduleId, {
      moduleId,
      manifest,
      dependencies: new Set(manifest.dependencies || []),
      dependents: new Set(),
      visited: false,
      temporaryMark: false,
      permanentMark: false,
    });
  }

  /**
   * Constructs backward links from dependencies to their dependents.
   */
  public buildEdges(): void {
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        const depNode = this.nodes.get(depId);
        if (depNode) {
          depNode.dependents.add(node.moduleId);
        }
      }
    }
  }

  /**
   * Identifies any dependency module IDs that are declared but missing from the loaded modules list.
   */
  public findMissingDependencies(): { moduleId: string; missingId: string }[] {
    const missing: { moduleId: string; missingId: string }[] = [];
    for (const node of this.nodes.values()) {
      for (const depId of node.dependencies) {
        if (!this.nodes.has(depId)) {
          missing.push({ moduleId: node.moduleId, missingId: depId });
        }
      }
    }
    return missing;
  }

  /**
   * Resets all permanent and temporary marks before a traversal pass.
   */
  public resetMarks(): void {
    for (const node of this.nodes.values()) {
      node.visited = false;
      node.temporaryMark = false;
      node.permanentMark = false;
    }
  }

  /**
   * Executes circular dependency checks using Depth-First Search (DFS) with node marking.
   * Returns a detailed cycle path (e.g. ['Trading', 'Portfolio', 'Trading']) or null if acyclic.
   */
  public findCircularDependencies(): string[] | null {
    this.resetMarks();

    const sortedModuleIds = Array.from(this.nodes.keys()).sort();
    const visitStack: string[] = [];

    const dfs = (nodeId: string): string[] | null => {
      const node = this.nodes.get(nodeId);
      if (!node) return null;

      if (node.permanentMark) {
        return null;
      }

      if (node.temporaryMark) {
        // Construct the circular diagnostic loop path
        const startIndex = visitStack.indexOf(nodeId);
        if (startIndex !== -1) {
          return [...visitStack.slice(startIndex), nodeId];
        }
        return [nodeId];
      }

      node.temporaryMark = true;
      visitStack.push(nodeId);

      // Sort dependencies deterministically to guarantee constant path resolution
      const sortedDeps = Array.from(node.dependencies).sort();
      for (const depId of sortedDeps) {
        const cycle = dfs(depId);
        if (cycle) {
          return cycle;
        }
      }

      visitStack.pop();
      node.temporaryMark = false;
      node.permanentMark = true;
      return null;
    };

    for (const id of sortedModuleIds) {
      const cycle = dfs(id);
      if (cycle) {
        return cycle;
      }
    }

    return null;
  }
}
