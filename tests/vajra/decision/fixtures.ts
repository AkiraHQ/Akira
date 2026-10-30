import { CorrelationMetadata } from "../../../src/contracts/results/result";
import { ReasoningResult } from "../../../src/vajra/reasoning/types";
import { OperationalContext, createInitialOperationalContext } from "../../../src/vajra/types/operational-context";
import { SelfModel } from "../../../src/vajra/self-model/self-model";
import { DEFAULT_POLICY_ENVELOPE, PolicyEnvelope } from "../../../src/vajra/types/policy";
import { IOperationalStateStore } from "../../../src/vajra/ports/state-store";
import { DeliberationTrace } from "../../../src/vajra/types/trace";
import { VajraEscalationRecord } from "../../../src/vajra/types/escalation-record";
import { CapabilityDescriptor } from "../../../src/contracts/capabilities/descriptor";
import { z } from "zod";

export function createMockCorrelation(id: string = "test"): CorrelationMetadata {
  return {
    requestId: `req-${id}`,
    correlationId: `corr-${id}`,
    invocationId: `inv-${id}`,
  };
}

export function createMockReasoningResult(overrides?: Partial<ReasoningResult>): ReasoningResult {
  const correlation = createMockCorrelation();
  return {
    id: "res-reason-01",
    stimulusId: "stim-01",
    correlation,
    contextVersion: 1,
    problemClass: "POLICY_CONFORMANCE",
    strategyUsed: "DeterministicPolicyStrategy",
    strategyTier: 1,
    status: "SUCCESS",
    hypotheses: [
      {
        id: "hyp-01",
        description: "Operation satisfies policy constraints",
        confidence: 0.95,
        supportingEvidenceIds: ["obs-01"],
      },
    ],
    proposedBeliefUpdates: [],
    contradictions: [],
    possibleConsequences: ["Operation is safe to proceed"],
    uncertaintyLevel: "LOW",
    unresolvedQuestions: [],
    verificationSuggestions: [],
    deliberationTrace: {
      traceId: "trace-01",
      stimulusId: "stim-01",
      correlation,
      intentClass: "POLICY_CONFORMANCE",
      selectedOption: "concluded:success",
      consideredOptions: [],
      rationale: "Reasoning concluded nominal",
      evidenceReliedUpon: ["obs-01"],
      escalationRequired: false,
      timestamp: new Date().toISOString(),
    },
    ...overrides,
  };
}

export function createMockSelfModel(initialPolicy?: Partial<PolicyEnvelope>): SelfModel {
  const model = new SelfModel(initialPolicy);

  // Register standard capabilities for testing
  const taskCreateDesc: CapabilityDescriptor = {
    name: "task.create",
    version: "1.0.0",
    owner: "AKIRA OS",
    description: "Create a task",
    kind: "Command",
    inputSchema: z.object({ title: z.string() }),
    outputSchema: z.object({ id: z.string() }),
    permissions: { allowVajra: true, allowInternal: true },
    costClass: "local_cheap",
    activationTier: 0,
    isAvailable: true,
  };

  const restrictedDesc: CapabilityDescriptor = {
    name: "system.internal.raw",
    version: "1.0.0",
    owner: "AKIRA OS",
    description: "Restricted capability",
    kind: "Command",
    inputSchema: z.any(),
    outputSchema: z.any(),
    permissions: { allowVajra: false, allowInternal: true },
    costClass: "local_cheap",
    activationTier: 1,
    isAvailable: true,
  };

  model.registerCapability(taskCreateDesc);
  model.registerCapability(restrictedDesc);
  return model;
}

export interface MockStateStoreData {
  traces: DeliberationTrace[];
  escalations: Map<string, VajraEscalationRecord>;
  context: OperationalContext | null;
  savedBeliefCalls: number;
}

export function createMockStateStore(initialData?: Partial<MockStateStoreData>): {
  store: IOperationalStateStore;
  data: MockStateStoreData;
} {
  const data: MockStateStoreData = {
    traces: initialData?.traces ?? [],
    escalations: initialData?.escalations ?? new Map(),
    context: initialData?.context ?? createInitialOperationalContext(),
    savedBeliefCalls: 0,
  };

  const store: IOperationalStateStore = {
    async saveOperationalContext(ctx) {
      data.context = ctx;
    },
    async loadOperationalContext() {
      return data.context;
    },
    async saveBelief(_belief) {
      data.savedBeliefCalls++;
    },
    async loadBeliefs() {
      return [];
    },
    async getBelief() {
      return null;
    },
    async deleteBelief() {},
    async appendAuditTrace(trace) {
      data.traces.push(trace);
    },
    async queryAuditTraces() {
      return data.traces;
    },
    async queryAuditTracesByCorrelation(corrId) {
      return data.traces.filter((t) => t.correlation.correlationId === corrId);
    },
    async queryAuditTracesByStimulus(stimId) {
      return data.traces.filter((t) => t.stimulusId === stimId);
    },
    async createMission() {},
    async getMission() {
      return null;
    },
    async getActiveMission() {
      return null;
    },
    async updateMissionLifecycle() {},
    async getStep() {
      return null;
    },
    async getStepsForMission() {
      return [];
    },
    async preDispatchStep() {},
    async recordStepExecution() {},
    async failStep() {},
    async createEscalation(esc) {
      data.escalations.set(esc.id, esc);
    },
    async getEscalation(id) {
      return data.escalations.get(id) ?? null;
    },
    async resolveEscalation(id, status, comment, resolvedAt) {
      const existing = data.escalations.get(id);
      if (existing) {
        data.escalations.set(id, {
          ...existing,
          status,
          resolutionComment: comment ?? existing.resolutionComment,
          resolvedAt: resolvedAt ?? new Date().toISOString(),
        });
      }
    },
    async getPendingEscalations() {
      return Array.from(data.escalations.values()).filter((e) => e.status === "PENDING_APPROVAL");
    },
    async saveVerification() {},
    async getVerificationsForStep() {
      return [];
    },
    async getVerificationsForMission() {
      return [];
    },
    async getExecutionProvenance() {
      return [];
    },
    async detectInterruptedMissions() {
      return [];
    },
  };

  return { store, data };
}
