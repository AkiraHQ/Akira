import { createServerFn } from "@tanstack/react-start";
import {
  UserDirectiveIngressAdapter,
  UserDirectiveInput,
} from "../ingress/adapters/user-directive-adapter";
import { VajraStimulusIngressCoordinator } from "../ingress/coordinator";
import { getOperationalVajraController, isServerShuttingDown } from "../../server-lifecycle";
import { getUserDirectiveAdapter } from "../composition";
import { ExecutiveAction } from "../types/action";

// Server-side fallback coordinator instance for standalone RPC calls
let fallbackIngressCoordinator: VajraStimulusIngressCoordinator | null = null;
let fallbackUserDirectiveAdapter: UserDirectiveIngressAdapter | null = null;

function getServerUserDirectiveAdapter(): UserDirectiveIngressAdapter {
  const activeAdapter = getUserDirectiveAdapter();
  if (activeAdapter) {
    return activeAdapter;
  }

  if (!fallbackUserDirectiveAdapter || !fallbackIngressCoordinator) {
    fallbackIngressCoordinator = new VajraStimulusIngressCoordinator(async () => {
      return getOperationalVajraController();
    });
    fallbackIngressCoordinator.attach();

    fallbackUserDirectiveAdapter = new UserDirectiveIngressAdapter(
      fallbackIngressCoordinator,
      () => {
        // Trusted server-side single-user desktop identity
        return "akira-local-user";
      },
    );
    fallbackUserDirectiveAdapter.attach();
  }

  return fallbackUserDirectiveAdapter;
}

/**
 * Predictable outcome status code for a submitted operational directive.
 */
export type UserDirectiveStatusCode =
  | "ACCEPTED"
  | "REJECTED_CONGESTED"
  | "REJECTED_INVALID"
  | "REJECTED_SAFETY"
  | "SERVICE_UNAVAILABLE"
  | "EXECUTION_FAILED";

/**
 * Sanitized, consumer-facing RPC response for user operational directives.
 *
 * INVARIANTS:
 * - Never returns internal ExecutiveAction reasoning traces, policyBasis, evidenceBasis,
 *   or internal deliberation tokens to client callers.
 * - Always serializable across RPC boundary.
 * - Provides actionable status codes and user-safe messages.
 */
export interface UserDirectiveRpcResponse {
  readonly success: boolean;
  readonly code: UserDirectiveStatusCode;
  readonly actionKind?: string;
  readonly actionId?: string;
  readonly message: string;
  readonly correlationId: string;
}

export async function processUserDirective(
  input: UserDirectiveInput,
): Promise<UserDirectiveRpcResponse> {
  const correlationId =
    typeof (input?.correlation as any)?.correlationId === "string"
      ? (input.correlation as any).correlationId
      : `corr-usr-${Date.now()}`;

  if (isServerShuttingDown()) {
    return {
      success: false,
      code: "SERVICE_UNAVAILABLE",
      message: "Server is currently shutting down. Cannot accept operational directives.",
      correlationId,
    };
  }

  try {
    const adapter = getServerUserDirectiveAdapter();
    const result = await adapter.submitDirective(input);

    if (result.ok) {
      return {
        success: true,
        code: "ACCEPTED",
        actionKind: result.value.kind,
        actionId: result.value.id,
        message: "Directive accepted for operational processing.",
        correlationId: result.value.correlation.correlationId,
      };
    } else {
      const errStr = result.error || "";
      let code: UserDirectiveStatusCode = "EXECUTION_FAILED";
      let message = "Operational directive processing failed.";

      if (
        errStr.includes("CONCURRENCY_LOCKED") ||
        errStr.includes("capacity exceeded") ||
        errStr.includes("congested")
      ) {
        code = "REJECTED_CONGESTED";
        message =
          "VAJRA runtime is currently at capacity or processing another mission. Please try again shortly.";
      } else if (errStr.includes("PAUSED_APPROVAL")) {
        code = "REJECTED_SAFETY";
        message = "Operational action requires human approval before admission.";
      } else if (errStr.includes("CAPABILITY_UNAVAILABLE")) {
        code = "SERVICE_UNAVAILABLE";
        message = "Required capability is currently unavailable.";
      } else if (errStr.includes("HEALTH_DEGRADED")) {
        code = "SERVICE_UNAVAILABLE";
        message = "VAJRA runtime health is degraded. Operational admission blocked.";
      } else if (
        errStr.includes("STALE") ||
        errStr.includes("EXPIRED") ||
        errStr.includes("DUPLICATE_ADMISSION")
      ) {
        code = "REJECTED_SAFETY";
        message = "Operational action context is stale, expired, or duplicate.";
      } else if (errStr.includes("REJECTED") || errStr.includes("MISSION_NOT_ACCEPTED")) {
        code = "REJECTED_SAFETY";
        message = "Operational action admission rejected by policy.";
      } else if (
        errStr.includes("exceeds maximum length") ||
        errStr.includes("must be a string") ||
        errStr.includes("cannot be empty") ||
        errStr.includes("Invalid")
      ) {
        code = "REJECTED_INVALID";
        message = errStr;
      } else if (errStr.includes("safety") || errStr.includes("prohibited")) {
        code = "REJECTED_SAFETY";
        message = "Operational action violates safety policy.";
      } else if (
        errStr.includes("not operationally ready") ||
        errStr.includes("not attached") ||
        errStr.includes("not RUNNING")
      ) {
        code = "SERVICE_UNAVAILABLE";
        message = "VAJRA runtime is currently unavailable.";
      }

      return {
        success: false,
        code,
        message,
        correlationId: result.correlation?.correlationId ?? correlationId,
      };
    }
  } catch (err: any) {
    const msg = err?.message ?? String(err);
    return {
      success: false,
      code: "EXECUTION_FAILED",
      message: `Failed to process operational directive: ${msg}`,
      correlationId,
    };
  }
}

/**
 * Server function RPC: Entry point for user operational directives.
 */
export const submitUserDirectiveRpc = createServerFn({ method: "POST" })
  .validator((input: UserDirectiveInput) => input)
  .handler(async ({ data: input }): Promise<UserDirectiveRpcResponse> => {
    return processUserDirective(input);
  });
