import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("VAJRA Persistence Boundary Invariant Tests", () => {
  const vajraDir = path.join(process.cwd(), "src", "vajra");

  function getTsFiles(dir: string): string[] {
    const results: string[] = [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        results.push(...getTsFiles(fullPath));
      } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
        results.push(fullPath);
      }
    }
    return results;
  }

  it("ensures ZERO imports of better-sqlite3 across the entire src/vajra/ domain", () => {
    const files = getTsFiles(vajraDir);
    expect(files.length).toBeGreaterThan(0);

    const violations: string[] = [];
    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (content.includes("better-sqlite3")) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(
      violations,
      `Source files in src/vajra must never import better-sqlite3: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("ensures ZERO direct database repository or connection imports in src/vajra/", () => {
    const files = getTsFiles(vajraDir);
    const violations: string[] = [];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      if (
        content.includes("src/persistence/repositories") ||
        content.includes("src/persistence/connection") ||
        content.includes("../persistence/repositories") ||
        content.includes("../persistence/connection") ||
        content.includes("../../persistence/repositories") ||
        content.includes("../../persistence/connection")
      ) {
        violations.push(path.relative(process.cwd(), file));
      }
    }

    expect(
      violations,
      `Source files in src/vajra must never import repositories or database connections directly: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("ensures ZERO raw SQL query strings inside src/vajra/", () => {
    const files = getTsFiles(vajraDir);
    const violations: string[] = [];

    const sqlPatterns = [
      /SELECT\s+.+\s+FROM/i,
      /INSERT\s+INTO/i,
      /UPDATE\s+vajra_/i,
      /DELETE\s+FROM/i,
      /CREATE\s+TABLE/i,
      /DROP\s+TABLE/i,
    ];

    for (const file of files) {
      const content = fs.readFileSync(file, "utf8");
      for (const pattern of sqlPatterns) {
        if (pattern.test(content)) {
          violations.push(`${path.relative(process.cwd(), file)} matches ${pattern}`);
        }
      }
    }

    expect(
      violations,
      `Source files in src/vajra must never contain raw SQL statements: ${violations.join(", ")}`,
    ).toEqual([]);
  });

  it("verifies SqliteOperationalStateStore resides in src/persistence/vajra/ and implements IOperationalStateStore", () => {
    const adapterPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "vajra",
      "sqlite-operational-state-store.ts",
    );
    expect(fs.existsSync(adapterPath), "SqliteOperationalStateStore file must exist in src/persistence/vajra/").toBe(true);

    const content = fs.readFileSync(adapterPath, "utf8");
    expect(content).toContain("implements IOperationalStateStore");
  });
});
