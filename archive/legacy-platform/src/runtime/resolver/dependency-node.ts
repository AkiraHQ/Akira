import { ModuleManifest } from "../manifest";

export interface DependencyNode {
  moduleId: string;
  manifest: ModuleManifest;
  dependencies: Set<string>; // set of moduleIds this node depends on
  dependents: Set<string>; // set of moduleIds that depend on this node
  visited: boolean;
  temporaryMark: boolean;
  permanentMark: boolean;
}
