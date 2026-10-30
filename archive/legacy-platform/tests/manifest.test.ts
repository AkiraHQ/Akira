import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "fs";
import * as path from "path";
import {
  RuntimeManager,
  ModuleState,
  ManifestLoader,
  ManifestValidator,
  MissingFieldError,
  InvalidVersionError,
  DuplicateModuleError,
  DuplicateCapabilityError,
  DuplicateRouteError,
  UnknownPropertyError,
  ManifestValidationError,
  parseYaml,
} from "../src/runtime";

describe("Platform Runtime - Module Manifest System", () => {
  const tempDir = path.resolve(__dirname, "temp_manifest_modules");
  const tempDupDir = path.resolve(__dirname, "temp_dup_modules");

  // Define temporary module subdirectories inside discovery directory
  const validModDir = path.join(tempDir, "valid-module");
  const disabledModDir = path.join(tempDir, "disabled-module");
  const malformedModDir = path.join(tempDir, "malformed-module");

  // Define duplicate route module directory outside discovery directory
  const dupRouteModDir = path.join(tempDupDir, "dup_route_mod");

  beforeAll(() => {
    // Setup discovery dir
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    fs.mkdirSync(validModDir, { recursive: true });
    fs.mkdirSync(disabledModDir, { recursive: true });
    fs.mkdirSync(malformedModDir, { recursive: true });

    // Setup duplicate dir
    if (!fs.existsSync(tempDupDir)) {
      fs.mkdirSync(tempDupDir, { recursive: true });
    }
    fs.mkdirSync(dupRouteModDir, { recursive: true });

    // 1. Valid Module: manifest.yaml + startup.js
    // Note: dependencies list is kept empty to avoid missing dependency failures under Sprint 2.1 Resolver
    fs.writeFileSync(
      path.join(validModDir, "manifest.yaml"),
      `
id: valid-module
name: Valid Module
version: 1.2.3
sdkVersion: ^1.7
description: Standard valid module manifest file
author: AKIRA OS Team
homepage: https://akira-os.org
repository: https://github.com/akira-os/valid-mod
license: MIT
permissions:
  - internet
  - storage
dependencies: []
capabilities:
  - data-export
routes:
  - /export-route
events:
  publishes:
    - export.done
  subscribes:
    - import.started
startup: index.js
enabled: true
      `,
    );
    fs.writeFileSync(
      path.join(validModDir, "index.js"),
      "export default { name: 'valid-module', version: '1.2.3', startup: () => {} };",
    );

    // 2. Disabled Module: manifest.yaml + startup.js
    fs.writeFileSync(
      path.join(disabledModDir, "manifest.yaml"),
      `
id: disabled-module
name: Disabled Module
version: 1.0.0
sdkVersion: ^1.7
description: This module is disabled
author: AKIRA OS Team
enabled: false
startup: index.js
      `,
    );
    fs.writeFileSync(
      path.join(disabledModDir, "index.js"),
      "export default { name: 'disabled-module', version: '1.0.0' };",
    );

    // 3. Malformed Module (invalid YAML structure)
    fs.writeFileSync(
      path.join(malformedModDir, "manifest.yaml"),
      `
id: malformed-module
name: Malformed
version: 1.0.0
sdkVersion: ^1.7
description: Malformed YAML indentation
  author: AKIRA OS Team
 - some list
invalid-yaml: [unclosed brackets
      `,
    );

    // 4. Duplicate Route Module: manifest.yaml
    fs.writeFileSync(
      path.join(dupRouteModDir, "manifest.yaml"),
      `
id: duplicate-route-module
name: Duplicate Route Module
version: 1.0.0
sdkVersion: ^1.7
description: Conflicting route
author: AKIRA OS Team
routes:
  - /export-route
startup: index.js
      `,
    );
    fs.writeFileSync(
      path.join(dupRouteModDir, "index.js"),
      "export default { name: 'duplicate-route-module', version: '1.0.0' };",
    );
  });

  afterAll(() => {
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    if (fs.existsSync(tempDupDir)) {
      fs.rmSync(tempDupDir, { recursive: true, force: true });
    }
  });

  // Helper to convert Windows absolute path to importable file URL
  function getImportPath(absolutePath: string): string {
    return `file:///${absolutePath.replace(/\\/g, "/")}`;
  }

  describe("YAML Parser Unit Tests", () => {
    it("should correctly parse standard YAML key-value pairs, nested maps, and lists", () => {
      const yaml = `
key1: value1
key2: true
key3: false
key4: 123
list1:
  - item1
  - item2
nested:
  subKey: subValue
      `;
      const parsed = parseYaml(yaml);
      expect(parsed.key1).toBe("value1");
      expect(parsed.key2).toBe(true);
      expect(parsed.key3).toBe(false);
      expect(parsed.key4).toBe(123);
      expect(parsed.list1).toEqual(["item1", "item2"]);
      expect(parsed.nested).toEqual({ subKey: "subValue" });
    });
  });

  describe("Manifest Schema & Duplicate Validator", () => {
    it("should accept a complete valid manifest", () => {
      const raw = {
        id: "test",
        name: "Test Module",
        version: "1.0.0",
        sdkVersion: "^1.5",
        description: "Valid test manifest",
        author: "Dev",
        routes: ["/test-route"],
        capabilities: ["test-cap"],
        events: {
          publishes: ["test.pub"],
        },
      };

      const validated = ManifestValidator.validateSchema(raw);
      expect(validated.id).toBe("test");
      expect(validated.version).toBe("1.0.0");
      expect(validated.routes).toContain("/test-route");
    });

    it("should throw MissingFieldError when a required field is absent or empty", () => {
      const missingId = {
        name: "Test",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "desc",
        author: "me",
      };
      expect(() => ManifestValidator.validateSchema(missingId)).toThrow(MissingFieldError);

      const emptyName = {
        id: "test",
        name: "",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "desc",
        author: "me",
      };
      expect(() => ManifestValidator.validateSchema(emptyName)).toThrow(MissingFieldError);
    });

    it("should throw InvalidVersionError when version or sdkVersion strings are invalid semver", () => {
      const invalidVer = {
        id: "test",
        name: "test",
        version: "1.a.0",
        sdkVersion: "^1.0",
        description: "desc",
        author: "me",
      };
      expect(() => ManifestValidator.validateSchema(invalidVer)).toThrow(InvalidVersionError);

      const invalidSdk = {
        id: "test",
        name: "test",
        version: "1.0.0",
        sdkVersion: "invalid-range",
        description: "desc",
        author: "me",
      };
      expect(() => ManifestValidator.validateSchema(invalidSdk)).toThrow(InvalidVersionError);
    });

    it("should throw UnknownPropertyError when unknown manifest properties are supplied", () => {
      const unknownProp = {
        id: "test",
        name: "test",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "desc",
        author: "me",
        someExtraKey: "not allowed in strict schema",
      };
      expect(() => ManifestValidator.validateSchema(unknownProp)).toThrow(UnknownPropertyError);
    });

    it("should throw ManifestValidationError when events publishes or subscribes have invalid items", () => {
      const invalidEvent = {
        id: "test",
        name: "test",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "desc",
        author: "me",
        events: {
          publishes: [""], // empty event name
        },
      };
      expect(() => ManifestValidator.validateSchema(invalidEvent)).toThrow(ManifestValidationError);
    });

    it("should throw DuplicateModuleError for duplicate module IDs", () => {
      const manifest = {
        id: "mod-1",
        name: "M1",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "d",
        author: "a",
      };
      const existing = [
        {
          id: "mod-1",
          name: "Existing",
          version: "1.0.0",
          sdkVersion: "^1.0",
          description: "d",
          author: "a",
        },
      ];
      expect(() => ManifestValidator.validateDuplicates(manifest, existing)).toThrow(
        DuplicateModuleError,
      );
    });

    it("should throw DuplicateCapabilityError for duplicate capabilities claimed across modules", () => {
      const manifest = {
        id: "mod-2",
        name: "M2",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "d",
        author: "a",
        capabilities: ["engine"],
      };
      const existing = [
        {
          id: "mod-1",
          name: "M1",
          version: "1.0.0",
          sdkVersion: "^1.0",
          description: "d",
          author: "a",
          capabilities: ["engine"],
        },
      ];
      expect(() => ManifestValidator.validateDuplicates(manifest, existing)).toThrow(
        DuplicateCapabilityError,
      );
    });

    it("should throw DuplicateRouteError for duplicate route maps claimed across modules", () => {
      const manifest = {
        id: "mod-2",
        name: "M2",
        version: "1.0.0",
        sdkVersion: "^1.0",
        description: "d",
        author: "a",
        routes: ["/dashboard"],
      };
      const existing = [
        {
          id: "mod-1",
          name: "M1",
          version: "1.0.0",
          sdkVersion: "^1.0",
          description: "d",
          author: "a",
          routes: ["/dashboard"],
        },
      ];
      expect(() => ManifestValidator.validateDuplicates(manifest, existing)).toThrow(
        DuplicateRouteError,
      );
    });
  });

  describe("Manifest Loader & Discovery", () => {
    it("should scan directory and discover all manifests matching YAML or JSON types", async () => {
      const discovered = await ManifestLoader.discover(tempDir);

      expect(discovered.length).toBeGreaterThanOrEqual(3);
      const ids = discovered.map((d) => d.id);
      expect(ids).toContain("valid-module");
      expect(ids).toContain("disabled-module");
      expect(ids).toContain("malformed-module");

      // Verify that valid module loaded manifest fields
      const valid = discovered.find((d) => d.id === "valid-module");
      expect(valid?.manifest.name).toBe("Valid Module");
      expect(valid?.manifest.capabilities).toContain("data-export");

      // Verify malformed module returned null manifest
      const malformed = discovered.find((d) => d.id === "malformed-module");
      expect(malformed?.manifest).toBeNull();
    });
  });

  describe("Runtime Integration", () => {
    it("should discover, validate, and load modules during initialization, skipping disabled ones and continuing on failures", async () => {
      const manager = new RuntimeManager({
        modulesDir: tempDir,
      });

      await manager.initialize();

      // valid-module should be RUNNING
      const validInst = manager.getModule("valid-module");
      expect(validInst).toBeDefined();
      expect(validInst?.state).toBe(ModuleState.RUNNING);
      expect(validInst?.manifest.id).toBe("valid-module");

      // disabled-module should be registered but state: UNLOADED
      const disabledInst = manager.getModule("disabled-module");
      expect(disabledInst).toBeDefined();
      expect(disabledInst?.state).toBe(ModuleState.UNLOADED);

      // malformed-module should be registered but state: FAILED
      const malformedInst = manager.getModule("malformed-module");
      expect(malformedInst).toBeDefined();
      expect(malformedInst?.state).toBe(ModuleState.FAILED);

      await manager.shutdown();
    });

    it("should load valid modules manually and reject duplicates", async () => {
      const manager = new RuntimeManager();

      // Load first valid module instance
      const m1 = await manager.loadModule(
        "instance-1",
        getImportPath(path.join(validModDir, "index.js")),
      );
      expect(m1.state).toBe(ModuleState.RUNNING);

      // Loading a second instance pointing to the same folder should trigger a duplicate ID error
      await expect(
        manager.loadModule("instance-2", getImportPath(path.join(validModDir, "index.js"))),
      ).rejects.toThrow(DuplicateModuleError);

      // Loading another module with conflicting route maps should trigger a DuplicateRouteError
      await expect(
        manager.loadModule("instance-3", getImportPath(path.join(dupRouteModDir, "index.js"))),
      ).rejects.toThrow(DuplicateRouteError);

      await manager.shutdown();
    });
  });
});
