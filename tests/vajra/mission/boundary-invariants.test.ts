import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Mission Subsystem Boundary Invariants (Phase 6 Architecture Blast Doors)", () => {
  const missionDir = path.join(process.cwd(), "src", "vajra", "mission");

  function getMissionFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getMissionFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const missionFiles = getMissionFiles(missionDir);

  it("MUST NOT directly import SQLite drivers or execute raw SQL", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("better-sqlite3");
      expect(content).not.toContain("sqlite3");
      expect(content).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    }
  });

  it("MUST NOT directly import persistence repositories", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/persistence\/repositories/);
      expect(content).not.toMatch(/from\s+["'].*Sqlite[A-Za-z]+Repository/);
    }
  });

  it("MUST NOT spawn child processes or import child_process / worker_threads", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("child_process");
      expect(content).not.toContain("worker_threads");
      expect(content).not.toContain("cluster");
      expect(content).not.toMatch(/\b(spawn|exec|execSync|spawnSync|fork)\s*\(/);
    }
  });

  it("MUST NOT directly mutate filesystem via fs write methods", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/fs\.(writeFileSync|writeFile|unlink|rmdir|mkdir|appendFile)/);
    }
  });

  it("MUST NOT call process.exit (prohibited by system ESLint rule and blast doors)", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("process.exit");
    }
  });

  it("Preserves DAG-free Foundation Contracts (no dependsOn, predecessors, successors, callbacks)", () => {
    const contractsPath = path.join(process.cwd(), "src", "contracts", "mission", "mission-definition.ts");
    const content = fs.readFileSync(contractsPath, "utf8");

    // Strip comments to test actual code declarations
    const codeOnly = content.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(codeOnly).not.toMatch(/\bdependsOn\b/);
    expect(codeOnly).not.toMatch(/\bpredecessors\b/);
    expect(codeOnly).not.toMatch(/\bsuccessors\b/);
    expect(codeOnly).not.toMatch(/\bretryPolicy\b/);
    expect(codeOnly).not.toMatch(/\bonSuccess\b/);
    expect(codeOnly).not.toMatch(/\bonFailure\b/);
  });

  it("CoordinationDispatcher is the ONLY component in mission interacting with IAkiraOSPort", () => {
    for (const filePath of missionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      if (!filePath.endsWith("coordinator.ts")) {
        expect(content).not.toContain("IAkiraOSPort");
        expect(content).not.toContain("executeCapability");
      }
    }
  });
});
