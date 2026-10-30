import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Decision Subsystem Boundary Invariants (Phase 5 §31)", () => {
  const decisionDir = path.join(process.cwd(), "src", "vajra", "decision");

  function getDecisionFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    let files: string[] = [];
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files = files.concat(getDecisionFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const decisionFiles = getDecisionFiles(decisionDir);

  it("MUST NOT directly import better-sqlite3 or database drivers", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("better-sqlite3");
      expect(content).not.toContain("sqlite3");
      expect(content).not.toContain("getDatabaseConnection");
    }
  });

  it("MUST NOT directly import persistence repositories", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/persistence\/repositories/);
      expect(content).not.toMatch(/from\s+["'].*Sqlite[A-Za-z]+Repository/);
    }
  });

  it("MUST NOT directly spawn OS processes or import child_process", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("child_process");
      expect(content).not.toMatch(/\b(spawn|exec|execSync|fork)\s*\(/);
    }
  });

  it("MUST NOT directly mutate filesystem via fs write methods", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/fs\.(writeFileSync|writeFile|unlink|rmdir|mkdir|appendFile)/);
    }
  });

  it("MUST NOT directly invoke capabilities (executeCapability)", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("executeCapability");
    }
  });

  it("MUST NOT invoke saveBelief (Belief lifecycle authority preserved)", () => {
    for (const filePath of decisionFiles) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain(".saveBelief(");
    }
  });
});
