import { createServerFn } from "@tanstack/react-start";
import { AkiraState } from "../shared/types/store-types";

/**
 * Parses a settings blob that the store requires to be an array.
 *
 * `JSON.parse` proves the bytes are JSON; it does not prove the value has the
 * type the store will treat it as. That gap is not cosmetic, because `chat` and
 * `genesis_memories` are persisted by *whole-blob replacement*: `record()`
 * writes `applyDurableRetention([event, ...s.memories])` and `addChatMessage`
 * writes `[...s.chat, msg]`. Spreading a non-array either throws or, for a
 * string, silently spreads its characters -- and the resulting junk array is
 * then written over the real history.
 *
 * Measured against a healthy 7-event stream, one note added after the store had
 * been hydrated with a corrupt value:
 *
 *   {"not":"an array"}   write threw TypeError    disk intact (7)
 *   null                 write threw TypeError    disk intact (7)
 *   "hello"              write completed          disk clobbered  7 -> 6
 *   [{"no":"fields"}]    write completed          disk clobbered  7 -> 2
 *
 * The two that complete are the dangerous ones, and they are dangerous
 * precisely because the loader succeeds: hydration finishes, `__root.tsx`
 * renders `{hydrated ? <Outlet/> : null}`, and the user is working normally
 * while their cognitive history is replaced.
 *
 * Throwing here routes a wrong shape into the failure path malformed bytes
 * already take, which was measured to be safe: the loader throws,
 * `akira.initializeState` never runs, `hydrated` stays false, the UI gate stays
 * shut, and the blob on disk is left untouched for recovery. No new policy is
 * invented and no valid data changes behaviour -- absent still yields `[]` and
 * a well-formed array still passes through unchanged.
 *
 * Deliberately limited to the array-typed blobs. `profile`, `active_session`
 * and `last_project_id` are objects or scalars whose corruption is cosmetic and
 * whose correct fallback is a separate policy question; they are left alone.
 */
function parsePersistedArray(raw: string | null | undefined, key: string): unknown[] {
  if (!raw) return [];
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error(
      `Corrupt persisted state: "${key}" holds ${parsed === null ? "null" : typeof parsed}, ` +
        `expected an array. Refusing to hydrate so the stored value is not overwritten.`,
    );
  }
  return parsed;
}

export const getInitialState = createServerFn({ method: "GET" }).handler(async (): Promise<any> => {
  // Dynamic imports to prevent better-sqlite3 from leaking into browser packages
  const {
    projectRepository,
    noteRepository,
    sessionRepository,
    settingsRepository,
    vaultFileRepository,
    vaultFolderRepository,
  } = await import("./repositories");
  const { listTasksViaCapability } = await import("../akira-os/tasks/server");

  const projects = projectRepository.getAll();
  const tasks = await listTasksViaCapability();
  const notes = noteRepository.getAll();
  const sessions = sessionRepository.getAll();
  const vaultFiles = vaultFileRepository.getAll();
  const vaultFolders = vaultFolderRepository.getAll();

  const activeSessionRaw = settingsRepository.get("active_session");
  const activeSession = activeSessionRaw ? JSON.parse(activeSessionRaw) : null;

  const profileRaw = settingsRepository.get("profile");
  const profile = profileRaw
    ? JSON.parse(profileRaw)
    : {
        name: "Lovshik",
        role: "Developer",
        motto: "Building Akira",
      };

  const lastProjectIdRaw = settingsRepository.get("last_project_id");
  const lastProjectId = lastProjectIdRaw ? JSON.parse(lastProjectIdRaw) : null;

  const chat = parsePersistedArray(settingsRepository.get("chat"), "chat");

  const streaks = parsePersistedArray(settingsRepository.get("streaks"), "streaks");

  // The GENESIS MemoryEvent stream. Absent on a first run, which is why the
  // fallback is an empty list rather than an error: GENESIS simply starts with
  // nothing to reconstruct. A *present but wrongly shaped* value is the
  // opposite case and must not be waved through -- see `parsePersistedArray`.
  const memories = parsePersistedArray(
    settingsRepository.get("genesis_memories"),
    "genesis_memories",
  );

  return {
    projects,
    tasks,
    notes,
    sessions,
    activeSession,
    profile,
    // The row exists only once the profile has been saved; the fallback above
    // is for display and must not be mistaken for who the user is.
    profileSaved: profileRaw != null,
    lastProjectId,
    chat,
    streaks,
    memories,
    vaultFiles,
    vaultFolders,
  };
});
