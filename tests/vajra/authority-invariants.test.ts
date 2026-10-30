import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { SelfModel } from "../../src/vajra/self-model/self-model";
import { LiveAkiraOSAdapter } from "../../src/vajra/boundaries/akira-os-port";
import { StubHandsAdapter } from "../../src/vajra/boundaries/hands-port";
import { CapabilityRegistry } from "../../src/contracts/capabilities/registry";
import { CapabilityDescriptor } from "../../src/contracts/capabilities/descriptor";
import { CorrelationMetadata } from "../../src/contracts/results/result";
import { z } from "zod";

describe("VAJRA Authority Invariants (Target Architecture §1, §3, §22)", () => {
  const vajraDir = path.join(process.cwd(), "src", "vajra");

  // Helper to recursively collect all source files in src/vajra/
  function getVajraSourceFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getVajraSourceFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allVajraFiles = getVajraSourceFiles(vajraDir);

  it("MUST NOT directly import better-sqlite3 or database drivers", () => {
    for (const filePath of allVajraFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("better-sqlite3");
      expect(content).not.toContain("sqlite3");
      expect(content).not.toContain("getDatabaseConnection");
    }
  });

  it("MUST NOT directly import persistence repositories", () => {
    for (const filePath of allVajraFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/persistence\/repositories/);
      expect(content).not.toMatch(/from\s+["'].*Sqlite[A-Za-z]+Repository/);
    }
  });

  it("MUST NOT directly spawn OS processes or import child_process", () => {
    for (const filePath of allVajraFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("child_process");
      expect(content).not.toMatch(/\b(spawn|exec|execSync|fork)\s*\(/);
    }
  });

  it("MUST NOT directly mutate filesystem via fs write methods", () => {
    for (const filePath of allVajraFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/fs\.(writeFileSync|writeFile|unlink|rmdir|mkdir|appendFile)/);
    }
  });

  it("MUST uphold structural identity: 'I am the central brain; I cannot execute commands directly.'", () => {
    const selfModel = new SelfModel();
    const identity = selfModel.getIdentity();

    expect(identity.name).toBe("VAJRA");
    expect(identity.role).toBe("Central Cognitive Authority");
    expect(identity.authorityLevel).toBe(1);
    expect(identity.coreInvariant).toBe("I am the central brain; I cannot execute commands directly.");
    expect(identity.hierarchy).toEqual(["Human", "VAJRA", "SpecializedDomains", "Reality"]);
  });

  it("MUST enforce that Level 1 (VAJRA) permissions and prohibitions are strictly documented", () => {
    const selfModel = new SelfModel();
    const boundaries = selfModel.getAuthorityBoundaries();
    const vajraBoundary = boundaries.find((b) => b.level === 1);

    expect(vajraBoundary).toBeDefined();
    expect(vajraBoundary?.prohibitions).toContain("Direct file or filesystem mutation");
    expect(vajraBoundary?.prohibitions).toContain("Direct SQLite database connection or schema mutation");
    expect(vajraBoundary?.prohibitions).toContain("Direct subprocess spawning or OS execution");
    expect(vajraBoundary?.prohibitions).toContain("Direct actuation or control of HANDS");
  });

  it("MUST route capability calls through CapabilityRegistry with { isVajra: true }", async () => {
    const registry = new CapabilityRegistry();
    let receivedCallerContext: any = null;

    const dummyDescriptor: CapabilityDescriptor<{ msg: string }, { echo: string }> = {
      name: "test.echo",
      kind: "Query",
      version: "1.0.0",
      owner: "AKIRA_OS",
      description: "Test echo",
      inputSchema: z.object({ msg: z.string() }),
      outputSchema: z.object({ echo: z.string() }),
      permissions: { allowVajra: true },
      isAvailable: true,
    };

    registry.register(dummyDescriptor, (input) => {
      return { echo: input.msg };
    });

    const adapter = new LiveAkiraOSAdapter(registry);
    const correlation: CorrelationMetadata = {
      requestId: "req-1",
      correlationId: "corr-1",
      invocationId: "inv-1",
    };

    const result = await adapter.executeCapability("test.echo", { msg: "hello" }, correlation);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toEqual({ echo: "hello" });
    }
  });

  it("MUST reject capability invocations when descriptor disallows VAJRA (allowVajra: false)", async () => {
    const registry = new CapabilityRegistry();

    const restrictedDescriptor: CapabilityDescriptor = {
      name: "system.internal.only",
      kind: "Command",
      version: "1.0.0",
      owner: "AKIRA_OS",
      description: "Internal only capability",
      inputSchema: z.record(z.unknown()),
      outputSchema: z.record(z.unknown()),
      permissions: { allowVajra: false, allowInternal: true },
      isAvailable: true,
    };

    registry.register(restrictedDescriptor, () => ({ success: true }));

    const adapter = new LiveAkiraOSAdapter(registry);
    const correlation: CorrelationMetadata = {
      requestId: "req-2",
      correlationId: "corr-2",
      invocationId: "inv-2",
    };

    const result = await adapter.executeCapability("system.internal.only", {}, correlation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.category).toBe("command_rejection");
      expect(result.error.message).toContain("Invocation disallowed by permissions");
    }
  });

  it("MUST NOT directly actuate HANDS in Phase 2", async () => {
    const handsAdapter = new StubHandsAdapter();
    expect(handsAdapter.isAvailable()).toBe(false);

    const correlation: CorrelationMetadata = {
      requestId: "req-3",
      correlationId: "corr-3",
      invocationId: "inv-3",
    };

    const result = await handsAdapter.executeSandbox("ls", ["-la"], correlation);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("HANDS execution engine is not active in Phase 2");
    }
  });
});
