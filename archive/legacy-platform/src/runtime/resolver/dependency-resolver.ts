import { ModuleManifest } from "../manifest";
import { DependencyGraph } from "./dependency-graph";
import { MissingDependencyError, CircularDependencyError } from "./dependency-errors";

export interface ResolutionPlan {
  startupOrder: string[];
  shutdownOrder: string[];
  missingDependencies: { moduleId: string; missingId: string }[];
  circularDependencies: string[] | null;
  isValid: boolean;
}

export class DependencyResolver {
  private graph: DependencyGraph;
  private manifests: ModuleManifest[];

  constructor(manifests: ModuleManifest[]) {
    // Sort manifests by ID deterministically before graph generation
    this.manifests = [...manifests].sort((a, b) => a.id.localeCompare(b.id));
    this.graph = new DependencyGraph();
  }

  /**
   * Constructs the dependency graph from the initial manifest set.
   */
  public buildGraph(): DependencyGraph {
    this.graph = new DependencyGraph();

    for (const manifest of this.manifests) {
      this.graph.addNode(manifest.id, manifest);
    }

    this.graph.buildEdges();
    return this.graph;
  }

  /**
   * Identifies missing dependency references.
   */
  public findMissingDependencies(): { moduleId: string; missingId: string }[] {
    return this.graph.findMissingDependencies();
  }

  /**
   * Identifies circular loops.
   */
  public findCircularDependencies(): string[] | null {
    return this.graph.findCircularDependencies();
  }

  /**
   * Validates the graph integrity, raising typed exceptions on missing or circular targets.
   */
  public validate(): void {
    this.buildGraph(); // Ensure the graph is constructed before running validation queries

    const missing = this.findMissingDependencies();
    if (missing.length > 0) {
      throw new MissingDependencyError(missing[0].moduleId, missing[0].missingId);
    }

    const cycle = this.findCircularDependencies();
    if (cycle) {
      throw new CircularDependencyError(cycle);
    }
  }

  /**
   * Generates a complete startup and shutdown execution plan.
   */
  public resolve(): ResolutionPlan {
    this.buildGraph();

    const missing = this.findMissingDependencies();
    const cycle = this.findCircularDependencies();
    const isValid = missing.length === 0 && cycle === null;

    let startupOrder: string[] = [];
    if (isValid) {
      startupOrder = this.getStartupOrder();
    }

    return {
      startupOrder,
      shutdownOrder: [...startupOrder].reverse(),
      missingDependencies: missing,
      circularDependencies: cycle,
      isValid,
    };
  }

  /**
   * Returns a topologically sorted list of module IDs for startup (dependencies first).
   */
  public getStartupOrder(): string[] {
    this.validate(); // Builds the graph and asserts validity

    this.graph.resetMarks();
    const order: string[] = [];

    const visit = (nodeId: string) => {
      const node = this.graph.nodes.get(nodeId);
      if (!node || node.permanentMark) return;

      node.temporaryMark = true;

      // Deterministically traverse sorted dependencies
      const sortedDeps = Array.from(node.dependencies).sort();
      for (const depId of sortedDeps) {
        visit(depId);
      }

      node.temporaryMark = false;
      node.permanentMark = true;
      order.push(nodeId);
    };

    // Sort root nodes deterministically to avoid filesystem iteration side-effects
    const sortedIds = Array.from(this.graph.nodes.keys()).sort();
    for (const id of sortedIds) {
      visit(id);
    }

    return order;
  }

  /**
   * Returns the startup order reversed.
   */
  public getShutdownOrder(): string[] {
    return [...this.getStartupOrder()].reverse();
  }
}
