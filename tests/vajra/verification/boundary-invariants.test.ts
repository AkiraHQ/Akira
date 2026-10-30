import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("Observation, Verification & Closure Boundary Invariants (Phase 7 Architecture Blast Doors)", () => {
  const phase7Dirs = [
    path.join(process.cwd(), "src", "vajra", "observation"),
    path.join(process.cwd(), "src", "vajra", "verification"),
    path.join(process.cwd(), "src", "vajra", "closure"),
  ];

  function getTsFiles(dirs: string[]): string[] {
    let files: string[] = [];
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) continue;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          files = files.concat(getTsFiles([fullPath]));
        } else if (entry.name.endsWith(".ts")) {
          files.push(fullPath);
        }
      }
    }
    return files;
  }

  const phase7Files = getTsFiles(phase7Dirs);

  it("must find all implemented Phase 7 TypeScript source files", () => {
    expect(phase7Files.length).toBeGreaterThanOrEqual(9);
  });

  it("MUST NOT directly import SQLite drivers or execute raw SQL queries (Invariant K-P7-10)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("better-sqlite3");
      expect(content).not.toContain("sqlite3");
      expect(content).not.toMatch(/\b(SELECT|INSERT INTO|UPDATE\s+\w+\s+SET|DELETE FROM)\b/i);
    }
  });

  it("MUST NOT directly import persistence repositories", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/persistence\/repositories/);
      expect(content).not.toMatch(/from\s+["'].*Sqlite[A-Za-z]+Repository/);
    }
  });

  it("MUST NOT spawn child processes or import child_process / worker_threads (Invariant K-P7-11)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("child_process");
      expect(content).not.toContain("worker_threads");
      expect(content).not.toContain("cluster");
      expect(content).not.toMatch(/\b(spawn|exec|execSync|spawnSync|fork)\s*\(/);
    }
  });

  it("MUST NOT directly mutate filesystem via fs write methods (Invariant K-P7-11)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/fs\.(writeFileSync|writeFile|unlink|rmdir|mkdir|appendFile)/);
    }
  });

  it("MUST NOT execute dynamic code via eval or new Function (Invariant K-P7-11)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/\beval\s*\(/);
      expect(content).not.toMatch(/new\s+Function\s*\(/);
    }
  });

  it("MUST NOT directly call IAkiraOSPort or executeCapability (Invariant K-P7-9)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("IAkiraOSPort");
      expect(content).not.toMatch(/\bexecuteCapability\b/);
    }
  });

  it("MUST NOT directly import GENESIS internal memory repositories (Invariant K-P7-8)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toMatch(/from\s+["'].*\/genesis\/memory/);
      expect(content).not.toMatch(/from\s+["'].*\/genesis\/identity/);
    }
  });

  it("MUST NOT call process.exit (prohibited by ESLint rule and blast doors)", () => {
    for (const filePath of phase7Files) {
      const content = fs.readFileSync(filePath, "utf8");
      expect(content).not.toContain("process.exit");
    }
  });
});
