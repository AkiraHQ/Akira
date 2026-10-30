/**
 * Platform event -> GENESIS MemoryEvent translation.
 *
 * This is the single definition of how an AKIRA OS event becomes something
 * GENESIS can record. It is pure: no bus, no subscription, no side effect, no
 * I/O. That matters because two callers share it —
 *
 *   - `event-service.ts`, whose legacy-bus subscription has always owned this
 *     logic inline, and
 *   - `reality-adapter.ts`, the instrumentation-bus boundary,
 *
 * and a second copy of these strings is exactly how `note.updated` drifted away
 * from every one of its consumers (see the P1 contract repair).
 *
 * The translator table doubles as the allowlist. Support for an event type and
 * the ability to translate it are the same fact, so they cannot disagree.
 *
 * Behaviour is preserved verbatim from the original `switch`, including the
 * places where a malformed payload throws rather than degrading — callers are
 * responsible for isolating that.
 */

import { MemoryEvent } from "../../shared/types/event-types";
import { Events } from "../../contracts/events";

/** The parts of a MemoryEvent that are derived from the platform event. */
export interface TranslatedEvent {
  eventType: MemoryEvent["eventType"];
  title: string;
  description: string;
  relatedProjectId: string | null;
  relatedNoteId: string | null;
}

/** Every deletion `akira-store` publishes carries the id and nothing else. */
interface DeletionPayload {
  id: string;
}

interface ProjectPayload {
  id: string;
  name: string;
}

interface TaskCompletedPayload {
  id: string;
  title: string;
  projectId: string | null;
}

interface LegacyMissionCompletedPayload {
  totalTasks: number;
}

interface VajraMissionOutcome {
  objective?: string;
  stepsCount?: number;
  verificationOutcome?: string;
  verifiedEvidenceIds?: readonly string[];
  completedAt?: string;
}

interface VajraMissionCompletedPayload {
  missionId: string;
  status: string;
  verificationRecordId?: string;
  outcome?: VajraMissionOutcome | unknown;
}

type MissionCompletedPayload =
  | LegacyMissionCompletedPayload
  | VajraMissionCompletedPayload;

interface NotePayload {
  id: string;
  title?: string;
  /**
   * The note body, as the user typed it.
   *
   * Optional because events recorded before this field existed are replayed
   * from the durable stream without it, and because a producer that has only a
   * title is still translatable. Both fall back to the previous wrapper text.
   */
  content?: string;
  projectId: string | null;
}

/**
 * A note's description: the user's own words, unwrapped.
 *
 * `description` is the only free text a Memory carries into cognition. Every
 * rule that reads a note reads this field -- the recall classifier, the
 * semantic relevance score, and `personalDeclarationRule`, whose patterns are
 * all first-person prefixes (`my goal is `, `i want to become `). A wrapper in
 * front of the text defeats all three, and it did: measured, no note written
 * through any capture surface ever produced a declaration, because the body was
 * not on the event and the description read `Captured thought: "<title>"`.
 *
 * So the body is returned verbatim when there is one. The title is not
 * prepended, deliberately: prefixing anything puts a token in front of the
 * declaration patterns again, and the title is already carried separately as
 * `metadata.title`, which the candidate rules and the validator read.
 *
 * The wrapper survives only as the fallback for a payload with no body -- an
 * event recorded before `content` existed, replayed from the durable stream.
 * Nothing is invented: a payload with neither body nor title still yields the
 * bare "raw thought" text, and the validator holds it.
 */
function noteDescription(payload: NotePayload, verb: "Captured" | "Updated"): string {
  const content = (payload.content ?? "").trim();
  if (content) return content;
  if (payload.title) return `${verb} thought: "${payload.title}"`;
  return verb === "Captured" ? "Captured raw thought" : "Updated raw thought";
}

/**
 * One translator per supported platform event type.
 *
 * `payload` is deliberately typed per entry rather than defensively widened:
 * the shapes below are what the producers in `akira-store` actually publish,
 * and narrowing here is what makes a producer payload change a compile error
 * instead of a silent `undefined` in a memory description.
 */
const TRANSLATORS: Record<string, (payload: never) => TranslatedEvent> = {
  [Events.PROJECT_CREATED]: (payload: ProjectPayload): TranslatedEvent => ({
    eventType: "project_created",
    title: "Project Created",
    description: `Started new project: ${payload.name}`,
    relatedProjectId: payload.id,
    relatedNoteId: null,
  }),

  // Deletion carries only an id -- `akira-store` publishes `{ id }` and the
  // name is already gone from the workspace by the time anything reads it. The
  // id is what cognition needs: it is how a fragment finds out that its subject
  // no longer exists.
  [Events.PROJECT_DELETED]: (payload: DeletionPayload): TranslatedEvent => ({
    eventType: "project_deleted",
    title: "Project Deleted",
    description: "Deleted a project",
    relatedProjectId: payload.id,
    relatedNoteId: null,
  }),

  [Events.NOTE_DELETED]: (payload: DeletionPayload): TranslatedEvent => ({
    eventType: "note_deleted",
    title: "Note Deleted",
    description: "Deleted a note",
    relatedProjectId: null,
    relatedNoteId: payload.id,
  }),

  [Events.PROJECT_UPDATED]: (payload: ProjectPayload): TranslatedEvent => ({
    eventType: "project_updated",
    title: "Project Updated",
    description: `Updated details for project: ${payload.name}`,
    relatedProjectId: payload.id,
    relatedNoteId: null,
  }),

  [Events.PROJECT_CONTINUED]: (payload: ProjectPayload): TranslatedEvent => ({
    eventType: "project_continued",
    title: "Project Continued",
    description: `Logged 5 minutes of work on project: ${payload.name}`,
    relatedProjectId: payload.id,
    relatedNoteId: null,
  }),

  [Events.TASK_COMPLETED]: (payload: TaskCompletedPayload): TranslatedEvent => ({
    eventType: "task_completed",
    title: "Task Completed",
    description: `Completed task: "${payload.title}"`,
    relatedProjectId: payload.projectId,
    relatedNoteId: null,
  }),

  [Events.MISSION_COMPLETED]: (payload: MissionCompletedPayload): TranslatedEvent => {
    // 1. Authoritative VAJRA Operational Mission Completion (Phase 7 Reality Closure)
    if (payload && "missionId" in payload && typeof payload.missionId === "string") {
      const vajraPayload = payload as VajraMissionCompletedPayload;
      const outcome = (vajraPayload.outcome && typeof vajraPayload.outcome === "object"
        ? vajraPayload.outcome
        : undefined) as VajraMissionOutcome | undefined;

      const objective = outcome?.objective?.trim();
      const title = objective
        ? `Mission Completed: ${objective}`
        : `Mission Completed: ${vajraPayload.missionId}`;
      const description = objective
        ? `Completed operational mission: "${objective}". Status: ${vajraPayload.status}.`
        : `Completed operational mission ${vajraPayload.missionId} with status: ${vajraPayload.status}.`;

      return {
        eventType: "mission_completed",
        title,
        description,
        relatedProjectId: null,
        relatedNoteId: null,
      };
    }

    // 2. Legacy daily task counter published by workspace UI
    const totalTasks =
      payload && "totalTasks" in payload && typeof payload.totalTasks === "number"
        ? payload.totalTasks
        : 0;

    return {
      eventType: "mission_completed",
      title: "Daily Tasks Completed",
      description: `Finished all ${totalTasks} tasks for today!`,
      relatedProjectId: null,
      relatedNoteId: null,
    };
  },

  [Events.NOTE_CREATED]: (payload: NotePayload): TranslatedEvent => ({
    eventType: "note_created",
    title: "Note Created",
    description: noteDescription(payload, "Captured"),
    relatedProjectId: payload.projectId,
    relatedNoteId: payload.id,
  }),

  [Events.NOTE_EDITED]: (payload: NotePayload): TranslatedEvent => ({
    eventType: "note_edited",
    title: "Note Edited",
    description: noteDescription(payload, "Updated"),
    relatedProjectId: payload.projectId,
    relatedNoteId: payload.id,
  }),
};

/**
 * The platform event types GENESIS currently understands.
 *
 * Derived from the translator table, so it cannot fall out of step with what
 * is actually translatable.
 *
 * `presence.updated` is deliberately absent. It translated cleanly but matched
 * no candidate rule, so it produced a MemoryEvent and nothing else — and it
 * fires on every store change plus a decay timer, which would have made it by
 * far the highest-volume input to an unbounded memory list. Re-admitting it
 * needs a candidate rule and a use case, not just an allowlist entry.
 */
export const SUPPORTED_PLATFORM_EVENT_TYPES: readonly string[] = Object.freeze(
  Object.keys(TRANSLATORS),
);

/** True when `type` is a platform event GENESIS can interpret. */
export function isTranslatable(type: string): boolean {
  return Object.prototype.hasOwnProperty.call(TRANSLATORS, type);
}

/**
 * Translates a platform event into the fields `eventService.record()` needs,
 * or returns null when GENESIS has no interpretation for the type.
 *
 * Throws only if a supported type arrives with a payload that does not match
 * its declared shape — the caller decides whether that is fatal.
 */
export function translatePlatformEvent(type: string, payload: unknown): TranslatedEvent | null {
  const translator = TRANSLATORS[type];
  if (!translator) return null;
  return (translator as (p: unknown) => TranslatedEvent)(payload);
}
