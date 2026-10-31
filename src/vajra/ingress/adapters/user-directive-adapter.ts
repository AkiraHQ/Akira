import { CorrelationMetadata, Result } from "../../../contracts/results/result";
import { createStimulus, CognitiveStimulus } from "../../types/stimulus";
import { ExecutiveAction } from "../../types/action";
import { HumanPromptPayload, IIngressAdapter, IVajraStimulusIngressCoordinator } from "../types";

export interface UserDirectiveInput {
  readonly text: string;
  readonly conversationId?: string;
  readonly correlation?: Partial<CorrelationMetadata>;
  // Explicitly ignore any browser-supplied identity or permissions
  readonly [key: string]: unknown;
}

const MAX_DIRECTIVE_LENGTH = 4000;

export class UserDirectiveIngressAdapter implements IIngressAdapter {
  readonly name = "user-directive-ingress";
  private attached = false;

  constructor(
    private readonly coordinator: IVajraStimulusIngressCoordinator,
    private readonly trustedIdentityResolver?: () => Promise<string> | string,
  ) {}

  isAttached(): boolean {
    return this.attached;
  }

  attach(): void {
    this.attached = true;
  }

  detach(): void {
    this.attached = false;
  }

  async submitDirective(input: UserDirectiveInput): Promise<Result<ExecutiveAction, string>> {
    const uid =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2) + Date.now().toString(36);

    const correlation: CorrelationMetadata = {
      requestId: input?.correlation?.requestId ?? `req-usr-${uid}`,
      correlationId: input?.correlation?.correlationId ?? `corr-usr-${uid}`,
      invocationId: `inv-usr-${uid}`,
      causationId: input?.correlation?.causationId,
    };

    if (!this.attached) {
      return Result.failure(
        "UserDirectiveIngressAdapter is not attached or server is shutting down.",
        correlation,
      );
    }

    // 1. Input Validation
    if (!input || typeof input !== "object") {
      return Result.failure("Invalid directive input: expected an object.", correlation);
    }

    if (typeof input.text !== "string") {
      return Result.failure("Directive text must be a string.", correlation);
    }

    const trimmed = input.text.trim();
    if (!trimmed) {
      return Result.failure("Directive text cannot be empty or whitespace-only.", correlation);
    }

    if (trimmed.length > MAX_DIRECTIVE_LENGTH) {
      return Result.failure(
        `Directive exceeds maximum length of ${MAX_DIRECTIVE_LENGTH} characters (received ${trimmed.length}).`,
        correlation,
      );
    }

    if (
      input.conversationId !== undefined &&
      (typeof input.conversationId !== "string" || !input.conversationId.trim())
    ) {
      return Result.failure(
        "Invalid conversationId: must be a non-empty string when provided.",
        correlation,
      );
    }

    // 2. Establish Local Desktop Identity (Server-side convention)
    // NOTE (Threat Model & Identity Context):
    // AKIRA is a desktop companion running on localhost. 'akira-local-user' is a local
    // application identity convention, not an authenticated multi-tenant identity.
    // Client-supplied 'userId' or 'authLevel' in input payloads are explicitly ignored
    // and stripped to ensure browser requests cannot forge elevated capabilities.
    let trustedActor = "akira-local-user";
    try {
      if (this.trustedIdentityResolver) {
        const resolved = await this.trustedIdentityResolver();
        if (resolved && typeof resolved === "string" && resolved.trim()) {
          trustedActor = resolved.trim();
        }
      }
    } catch (err) {
      console.warn(
        "[UserDirectiveIngressAdapter] Failed to resolve trusted identity, using default:",
        err,
      );
    }

    // 3. Construct Frozen CognitiveStimulus (kind: "human_prompt")
    const payload: HumanPromptPayload = Object.freeze({
      directive: trimmed,
      conversationId: input.conversationId?.trim(),
      actor: trustedActor,
      clientTimestamp: new Date().toISOString(),
    });

    const stimulus: CognitiveStimulus<HumanPromptPayload> = createStimulus({
      id: `stim-usr-${uid}`,
      kind: "human_prompt",
      source: "user.directive",
      payload,
      correlation,
    });

    // 5. Submit through Ingress Coordinator
    return this.coordinator.submitStimulus(stimulus);
  }
}
