import { z } from "zod";
import { CapabilityDescriptor } from "../../../contracts/capabilities/descriptor";
import { CapabilityRegistry } from "../../../contracts/capabilities/registry";
import type { Project } from "../../../shared/types/store-types";

/**
 * Input Schema for project.read capability.
 */
export const projectReadInputSchema = z.object({
  id: z.string().min(1, "Project ID must be a non-empty string"),
});

export type ProjectReadInput = z.infer<typeof projectReadInputSchema>;

/**
 * Descriptor for project.read Query capability per Contract K7 / K2.
 * Owner: AKIRA OS · workspace
 */
export const projectReadDescriptor: CapabilityDescriptor<ProjectReadInput, Project | null> = {
  name: "project.read",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Query",
  inputSchema: projectReadInputSchema,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: true, // MCP v0 read capability per Decision D4 / D5
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: true,
  },
};

/**
 * Handler for project.read capability.
 * Adapts existing SqliteProjectRepository without modifying repository internals.
 */
export async function projectReadHandler(input: ProjectReadInput): Promise<Project | null> {
  const { projectRepository } = await import("../../../persistence/repositories");
  const project = projectRepository.getById(input.id);
  return project ?? null;
}

/**
 * Input Schema for project.list capability.
 */
export const projectListInputSchema = z.object({});

export type ProjectListInput = z.infer<typeof projectListInputSchema>;

/**
 * Descriptor for project.list Query capability per Contract K7 / K2.
 * Owner: AKIRA OS · workspace
 */
export const projectListDescriptor: CapabilityDescriptor<ProjectListInput, Project[]> = {
  name: "project.list",
  version: "1.0.0",
  owner: "AKIRA OS · workspace",
  kind: "Query",
  inputSchema: projectListInputSchema,
  permissions: {
    allowInternal: true,
    allowVajra: true,
    allowExternalMcp: true,
  },
  activationTier: 1,
  isAvailable: true,
  costClass: "local_cheap",
  executionCharacteristics: {
    isSynchronous: true,
    isIdempotent: true,
    isReadOnly: true,
  },
};

/**
 * Handler for project.list capability.
 * Adapts existing SqliteProjectRepository without modifying repository internals.
 */
export async function projectListHandler(): Promise<Project[]> {
  const { projectRepository } = await import("../../../persistence/repositories");
  return projectRepository.getAll();
}

/**
 * Helper to register project read capabilities in the AKIRA OS Capability Registry.
 */
export function registerProjectCapabilities(registry: CapabilityRegistry): void {
  registry.register(projectReadDescriptor, projectReadHandler);
  registry.register(projectListDescriptor, projectListHandler);
}
