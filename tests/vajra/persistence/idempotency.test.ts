import { describe, it, expect, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { SqliteOperationalStateStore } from "../../../src/persistence/vajra/sqlite-operational-state-store";
import {
  createVajraMissionRecord,
  createVajraStepRecord,
} from "../../../src/vajra/types/mission-record";
import { createMissionDefinition } from "../../../src/contracts/mission/mission-definition";
import { createMissionState } from "../../../src/contracts/mission/mission-state";
import { SelfModel } from "../../../src/vajra/self-model/self-model";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";

function computeIdempotencyKey(missionId: string, stepOrder: number, input: unknown): string {
  const canonicalJson = JSON.stringify(input, Object.keys(input as object).sort());
  return crypto
    .createHash("sha256")
    .update(`${missionId}:${stepOrder}:${canonicalJson}`)
    .digest("hex");
}

describe("Idempotency Contract & Safety Tests", () => {
  let db: Database.Database;
  let store: SqliteOperationalStateStore;

  beforeEach(() => {
    db = new Database(":memory:");
    db.pragma("foreign_keys = ON");

    // Apply bootstrap schema
    const schemaPath = path.join(process.cwd(), "src", "persistence", "schema.sql");
    db.exec(fs.readFileSync(schemaPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (1, ?)").run(
      new Date().toISOString(),
    );

    // Apply migration 003
    const migPath = path.join(
      process.cwd(),
      "src",
      "persistence",
      "migrations",
      "003_vajra_operational_state.sql",
    );
    db.exec(fs.readFileSync(migPath, "utf8"));
    db.prepare("INSERT INTO schema_version (version, applied_at) VALUES (3, ?)").run(
      new Date().toISOString(),
    );

    store = new SqliteOperationalStateStore(db);
  });

  afterEach(() => {
    db.close();
  });

  it("produces deterministic SHA-256 keys for identical step inputs", () => {
    const key1 = computeIdempotencyKey("m-1", 1, { a: 1, b: 2 });
    const key2 = computeIdempotencyKey("m-1", 1, { b: 2, a: 1 });
    expect(key1).toBe(key2);

    const key3 = computeIdempotencyKey("m-1", 2, { a: 1, b: 2 });
    expect(key1).not.toBe(key3);
  });

  it("enforces uniqueness of idempotency keys in vajra_mission_steps", async () => {
    const def = createMissionDefinition({
      objective: "Idempotency test",
      steps: [],
      completionCriteria: { description: "done", requiredEvidence: [] },
      correlation: { requestId: "r-idem", correlationId: "c-idem", invocationId: "i-idem" },
    });
    const st = createMissionState({ missionId: "m-idem", definitionId: "d-idem" });

    const sharedKey = "unique-idempotency-key-001";

    const mission = createVajraMissionRecord({
      id: "m-idem",
      objective: "Idempotency test",
      lifecycleState: "RUNNING",
      definition: def,
      state: st,
      allocatedBudget: { maxCostCents: 10, maxSteps: 2 },
      idempotencyKey: "k-m-idem",
      requestId: "r-idem",
      correlationId: "c-idem",
      invocationId: "i-idem",
    });

    const step1 = createVajraStepRecord({
      id: "s-idem-1",
      missionId: "m-idem",
      stepOrder: 1,
      description: "Step 1",
      targetCapability: "cap.one",
      input: {},
      expectedEvidence: "ev1",
      idempotencyKey: sharedKey,
      correlationId: "c-idem",
    });

    const step2 = createVajraStepRecord({
      id: "s-idem-2",
      missionId: "m-idem",
      stepOrder: 2,
      description: "Step 2 with duplicate key",
      targetCapability: "cap.two",
      input: {},
      expectedEvidence: "ev2",
      idempotencyKey: sharedKey, // Duplicate!
      correlationId: "c-idem",
    });

    // Inserting both steps with identical idempotencyKey fails the UNIQUE index idx_vajra_steps_idempotency
    await expect(store.createMission(mission, [step1, step2])).rejects.toThrow();
  });

  it("fails safely by defaulting unknown idempotency to non-idempotent in SelfModel", () => {
    const selfModel = new SelfModel();

    // Descriptor without executionCharacteristics.isIdempotent defined
    const unknownCap: CapabilityDescriptor = {
      name: "custom.legacy_action",
      version: "1.0.0",
      owner: "system",
      description: "A legacy capability with unspecified idempotency",
      kind: "Command",
      category: "system",
      costClass: "local_cheap",
      activationTier: 1,
      permissions: { allowVajra: true },
      // executionCharacteristics omitted
    };

    selfModel.registerCapability(unknownCap);

    const info = selfModel.getCapability("custom.legacy_action");
    expect(info).toBeDefined();
    // Invariant: Fail-safe default is false (strictly non-idempotent)
    expect(info?.limitations.isIdempotent).toBe(false);
  });
});
