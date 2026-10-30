import { IModuleInstance, ModuleInstance, ModuleDefinition } from "./module-instance";
import { ModuleContext } from "./module-context";
import { ModuleManifest } from "./manifest";
import { ManifestLoader } from "./manifest/manifest-loader";
import { ManifestValidator } from "./manifest/manifest-validator";
import * as fs from "fs";
import * as path from "path";

export interface IModuleLoader {
  load(
    id: string,
    modulePath: string,
    context: ModuleContext,
    manifest?: ModuleManifest,
  ): Promise<IModuleInstance>;
}

export class ModuleLoader implements IModuleLoader {
  /**
   * Loads a module dynamically from the given file system path or import path.
   * Creates and returns a ModuleInstance in the LOADED state.
   */
  public async load(
    id: string,
    modulePath: string,
    context: ModuleContext,
    manifest?: ModuleManifest,
  ): Promise<IModuleInstance> {
    try {
      // Strip file:/// prefix to work on normal OS paths
      let normalizedPath = modulePath;
      if (normalizedPath.startsWith("file:///")) {
        normalizedPath = normalizedPath.substring(8);
      }
      normalizedPath = path.normalize(normalizedPath);

      context.logger.info(`ModuleLoader: resolving module "${id}" at path "${normalizedPath}"`);

      // Determine or load manifest if not explicitly provided
      let resolvedManifest = manifest;
      if (!resolvedManifest) {
        const fileStat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null;
        const searchDir = fileStat?.isDirectory() ? normalizedPath : path.dirname(normalizedPath);

        const possibleManifests = [
          path.join(searchDir, "manifest.yaml"),
          path.join(searchDir, "manifest.yml"),
          path.join(searchDir, "manifest.json"),
        ];

        for (const mPath of possibleManifests) {
          if (fs.existsSync(mPath)) {
            try {
              const rawManifest = await ManifestLoader.load(mPath);
              resolvedManifest = ManifestValidator.validateSchema(rawManifest);
              context.logger.info(
                `ModuleLoader: Auto-resolved manifest for module "${id}" at "${mPath}"`,
              );
              break;
            } catch (err: any) {
              context.logger.warn(
                `ModuleLoader: Found manifest at "${mPath}" but failed validation: ${err.message}`,
              );
            }
          }
        }
      }

      // Resolve the actual module entry file path to import
      let entryFile = normalizedPath;
      const fileStat = fs.existsSync(normalizedPath) ? fs.statSync(normalizedPath) : null;
      if (fileStat?.isDirectory()) {
        if (resolvedManifest && resolvedManifest.startup) {
          entryFile = path.isAbsolute(resolvedManifest.startup)
            ? resolvedManifest.startup
            : path.join(normalizedPath, resolvedManifest.startup);
        } else {
          // Look for index.ts or index.js in directory
          const possibleEntries = [
            path.join(normalizedPath, "index.ts"),
            path.join(normalizedPath, "index.js"),
          ];
          for (const entry of possibleEntries) {
            if (fs.existsSync(entry)) {
              entryFile = entry;
              break;
            }
          }
        }
      }

      // Format target import URL using file:/// schema
      const importTarget = `file:///${entryFile.replace(/\\/g, "/")}`;

      // Dynamically import the target module
      let moduleExports: any;
      try {
        moduleExports = await import(importTarget);
      } catch (importError: any) {
        throw new Error(
          `Failed to dynamically import module path "${importTarget}": ${importError.message}`,
        );
      }

      const definition: ModuleDefinition = moduleExports.default || moduleExports;

      if (!definition) {
        throw new Error(`Module exports at "${importTarget}" do not contain a valid definition`);
      }

      // Validate that legacy files loaded without a manifest still define name and version
      if (!resolvedManifest && (!definition.name || !definition.version)) {
        throw new Error(
          `Module definition at "${importTarget}" is missing required "name" or "version" properties`,
        );
      }

      // Combine definition and resolved/default manifest metadata
      const finalManifest: ModuleManifest = resolvedManifest || {
        id,
        name: definition.name || id,
        version: definition.version || "1.0.0",
        sdkVersion: "^1.0.0",
        description: "Implicitly generated manifest",
        author: "AKIRA",
        enabled: true,
      };

      const instance = new ModuleInstance(
        id,
        finalManifest.name,
        finalManifest.version,
        context,
        definition,
        finalManifest,
      );

      // Perform explicit transition from UNLOADED -> LOADED
      instance.loaded();

      return instance;
    } catch (error: any) {
      context.logger.error(
        `ModuleLoader: failed to load module "${id}" from "${modulePath}": ${error.message}`,
      );
      throw error;
    }
  }
}
