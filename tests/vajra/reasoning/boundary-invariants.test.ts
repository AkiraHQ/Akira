import { describe, it, expect } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";

describe("Phase 4 Boundary & Authority Invariants (AST Audit)", () => {
  const reasoningDir = path.resolve(__dirname, "../../../src/vajra/reasoning");

  function getTsFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...getTsFiles(fullPath));
      } else if (entry.name.endsWith(".ts")) {
        files.push(fullPath);
      }
    }
    return files;
  }

  const allReasoningFiles = getTsFiles(reasoningDir);

  it("proves src/vajra/reasoning contains zero imports of better-sqlite3 or raw database drivers", () => {
    for (const file of allReasoningFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain("better-sqlite3");
      expect(content).not.toContain("sqlite3");
    }
  });

  it("proves src/vajra/reasoning contains zero imports of child_process or process execution", () => {
    for (const file of allReasoningFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain("child_process");
      expect(content).not.toContain("spawn(");
      expect(content).not.toContain("exec(");
    }
  });

  it("proves src/vajra/reasoning contains zero direct imports of node:fs or filesystem mutation", () => {
    for (const file of allReasoningFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain("node:fs");
      expect(content).not.toContain("readFileSync");
      expect(content).not.toContain("writeFileSync");
    }
  });

  it("proves src/vajra/reasoning contains zero calls to saveBelief() (Invariant K-P4-4)", () => {
    for (const file of allReasoningFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain(".saveBelief(");
    }
  });

  it("proves src/vajra/reasoning contains zero legacy platform imports", () => {
    for (const file of allReasoningFiles) {
      const content = fs.readFileSync(file, "utf-8");
      expect(content).not.toContain("archive/legacy-platform");
      expect(content).not.toContain("@legacy");
    }
  });
});
