import * as fs from "fs";
import * as path from "path";
import { ModuleManifest } from "./manifest";
import { ManifestValidationError } from "./manifest-errors";

/**
 * A lightweight, zero-dependency YAML parser.
 * Handles key-value pairs, nested objects, and list arrays by tracking indentation stacks.
 */
export function parseYaml(yaml: string): any {
  const lines = yaml.split(/\r?\n/);
  const result: any = {};

  // Tracks active keys and parents. Root has indent -1.
  const stack: { indent: number; key: string; container: any }[] = [
    { indent: -1, key: "", container: result },
  ];

  for (let line of lines) {
    const commentIndex = line.indexOf("#");
    if (commentIndex !== -1) {
      line = line.substring(0, commentIndex);
    }

    const trimmed = line.trim();
    if (!trimmed) continue;

    const indent = line.length - line.trimStart().length;

    // Pop context stack until parent indent is smaller than current line indent
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const parentContext = stack[stack.length - 1];

    if (trimmed.startsWith("-")) {
      // It's a list item. The parent's key is the array identifier.
      const valStr = trimmed.substring(1).trim();

      // Basic brackets syntax verification
      if (valStr.startsWith("[") && !valStr.endsWith("]")) {
        throw new Error("YAML syntax error: unclosed brackets");
      }

      let val: any = valStr;
      if (
        (valStr.startsWith('"') && valStr.endsWith('"')) ||
        (valStr.startsWith("'") && valStr.endsWith("'"))
      ) {
        val = valStr.substring(1, valStr.length - 1);
      } else if (valStr === "[]") {
        val = [];
      } else if (valStr === "{}") {
        val = {};
      } else if (valStr === "true") {
        val = true;
      } else if (valStr === "false") {
        val = false;
      } else if (!isNaN(Number(valStr)) && valStr !== "") {
        val = Number(valStr);
      }

      const pKey = parentContext.key;
      const pContainer = parentContext.container;

      // Auto-convert parent value from empty map placeholder to array if first item
      if (!Array.isArray(pContainer[pKey])) {
        pContainer[pKey] = [];
      }
      pContainer[pKey].push(val);
    } else {
      const colonIndex = trimmed.indexOf(":");
      if (colonIndex === -1) continue;

      const key = trimmed.substring(0, colonIndex).trim();
      const valStr = trimmed.substring(colonIndex + 1).trim();

      const currentContainer = parentContext.key
        ? parentContext.container[parentContext.key]
        : parentContext.container;

      if (valStr === "") {
        // Nesting level starts
        currentContainer[key] = {};
        stack.push({ indent, key, container: currentContainer });
      } else {
        // Basic brackets syntax verification
        if (valStr.startsWith("[") && !valStr.endsWith("]")) {
          throw new Error("YAML syntax error: unclosed brackets");
        }

        let val: any = valStr;
        if (
          (valStr.startsWith('"') && valStr.endsWith('"')) ||
          (valStr.startsWith("'") && valStr.endsWith("'"))
        ) {
          val = valStr.substring(1, valStr.length - 1);
        } else if (valStr === "[]") {
          val = [];
        } else if (valStr === "{}") {
          val = {};
        } else if (valStr === "true") {
          val = true;
        } else if (valStr === "false") {
          val = false;
        } else if (!isNaN(Number(valStr)) && valStr !== "") {
          val = Number(valStr);
        }
        currentContainer[key] = val;
      }
    }
  }

  return result;
}

export interface DiscoveredModule {
  id: string;
  manifestPath: string;
  moduleDir: string;
  manifest: any;
}

export class ManifestLoader {
  /**
   * Reads, parses, and returns the manifest object from a file path.
   * Resolves JSON and YAML files based on extension.
   */
  public static async load(manifestPath: string): Promise<any> {
    const normalized = manifestPath.startsWith("file:///")
      ? manifestPath.substring(8).replace(/\\/g, "/")
      : manifestPath;

    if (!fs.existsSync(normalized)) {
      throw new ManifestValidationError(`Manifest file does not exist at "${normalized}"`);
    }

    let rawContent: string;
    try {
      rawContent = fs.readFileSync(normalized, "utf-8");
    } catch (err: any) {
      throw new ManifestValidationError(
        `Failed to read manifest file at "${normalized}": ${err.message}`,
      );
    }

    const ext = path.extname(normalized).toLowerCase();
    try {
      if (ext === ".json") {
        return JSON.parse(rawContent);
      } else if (ext === ".yaml" || ext === ".yml") {
        return parseYaml(rawContent);
      } else {
        throw new ManifestValidationError(`Unsupported manifest file extension: "${ext}"`);
      }
    } catch (parseError: any) {
      throw new ManifestValidationError(
        `Malformed manifest structure: Failed to parse "${normalized}": ${parseError.message}`,
      );
    }
  }

  /**
   * Discovers modules inside a modules directory by scanning subdirectories.
   * Looks for manifest.json, manifest.yaml, or manifest.yml.
   */
  public static async discover(modulesDir: string): Promise<DiscoveredModule[]> {
    const discovered: DiscoveredModule[] = [];
    const resolvedDir = path.resolve(modulesDir);

    if (!fs.existsSync(resolvedDir)) {
      return discovered;
    }

    try {
      const items = fs.readdirSync(resolvedDir);
      for (const item of items) {
        const itemPath = path.join(resolvedDir, item);
        const stat = fs.statSync(itemPath);

        if (stat.isDirectory()) {
          const possibleManifests = [
            path.join(itemPath, "manifest.yaml"),
            path.join(itemPath, "manifest.yml"),
            path.join(itemPath, "manifest.json"),
          ];

          for (const mPath of possibleManifests) {
            if (fs.existsSync(mPath)) {
              try {
                const manifest = await this.load(mPath);
                const id = manifest.id || item;
                discovered.push({
                  id,
                  manifestPath: mPath,
                  moduleDir: itemPath,
                  manifest,
                });
                break;
              } catch {
                discovered.push({
                  id: item,
                  manifestPath: mPath,
                  moduleDir: itemPath,
                  manifest: null,
                });
                break;
              }
            }
          }
        }
      }
    } catch {
      // Ignore reading errors
    }

    return discovered;
  }
}
