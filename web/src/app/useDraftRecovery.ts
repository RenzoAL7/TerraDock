import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { Draft, Project, Session } from "../lib/types";
import {
  DraftStore,
  groupOffers,
  openIndexedDb,
  projectLocation,
  recoverable,
  TAB_ID,
  type StoredDraft,
} from "./draftStore";
import type { DraftPresence } from "./useWorkspace";

/** Quiet period after the last keystroke before drafts reach the profile. */
const PERSIST_DELAY = 400;

let shared: Promise<DraftStore> | null = null;
function draftStore() {
  shared ??= openIndexedDb().then(
    (backend) => new DraftStore(backend, Date.now, TAB_ID),
  );
  return shared;
}

/**
 * Keeps this tab's drafts in the browser profile and offers the ones a closed
 * or reloaded tab left behind. Writes are debounced and asynchronous, so they
 * never sit between a keystroke and the live diagram.
 */
export function useDraftRecovery(
  session: Session | null,
  project: Project | null,
  drafts: Record<string, Draft>,
  presence: RefObject<DraftPresence | null>,
) {
  const [offers, setOffers] = useState<StoredDraft[]>([]);
  const locations = useRef(new Map<string, string>());
  const root = session?.root;
  const projectId = project?.id;
  const location = project ? projectLocation(project) : undefined;
  if (projectId && location !== undefined)
    locations.current.set(projectId, location);

  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const projectRef = useRef(project);
  projectRef.current = project;
  const pendingFlush = useRef<(() => void) | null>(null);

  // Offer what an earlier tab left for this project. Entries this tab wrote
  // itself (after a reconnect, for example) are not offers.
  useEffect(() => {
    if (!root || location === undefined) return;
    let active = true;
    void draftStore().then(async (store) => {
      // Let open tabs answer first: their drafts are not leftovers.
      await presence.current?.settled();
      const heard = presence.current?.heardTabs() ?? new Set<string>();
      const found = await store.load(root, location, heard);
      if (!active) return;
      const { offers: offered, stale } = recoverable(found, {
        tab: store.tab,
        owns: (key) => store.owns(key),
        heard,
        files: projectRef.current?.files ?? [],
      });
      // Nothing to recover when the file already has the draft's text.
      for (const entry of stale) void store.discard(entry.key);
      setOffers(offered);
    });
    return () => {
      active = false;
    };
  }, [root, location, projectId, presence]);

  // Typing a new draft for a file does not touch what another tab stored for
  // it: this tab writes under its own key and the offer stays until the user
  // restores, downloads or discards it.
  useEffect(() => {
    if (!root) return;
    const flush = () => {
      pendingFlush.current = null;
      void draftStore().then((store) =>
        store.persist(root, draftsRef.current, locations.current),
      );
    };
    pendingFlush.current = flush;
    const timer = window.setTimeout(flush, PERSIST_DELAY);
    return () => clearTimeout(timer);
  }, [root, drafts]);

  // Leaving the page cannot wait for the debounce.
  useEffect(() => {
    const leave = () => pendingFlush.current?.();
    const hidden = () => {
      if (document.visibilityState === "hidden") leave();
    };
    window.addEventListener("pagehide", leave);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", leave);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, []);

  const restore = useCallback(
    (entry: StoredDraft): Draft | null => {
      if (!projectId) return null;
      setOffers((current) => current.filter((o) => o.key !== entry.key));
      void draftStore().then((store) => store.adopt(entry));
      return {
        projectId,
        content: entry.content,
        baseRevision: entry.baseRevision,
        baseContent: entry.baseContent,
      };
    },
    [projectId],
  );
  const discard = useCallback((entry: StoredDraft) => {
    setOffers((current) => current.filter((o) => o.key !== entry.key));
    void draftStore().then((store) => store.discard(entry.key));
  }, []);
  /** Remove what other tabs left in this browser; resolves to the count. */
  const clearStored = useCallback(async () => {
    setOffers([]);
    // Copies of tabs that are still open stay: they would not rewrite them.
    return (await draftStore()).clear(presence.current?.liveTabs());
  }, [presence]);
  // Several closed tabs may have left a draft of the same file.
  const groups = useMemo(() => groupOffers(offers), [offers]);
  return { offers: groups, restore, discard, clearStored };
}
