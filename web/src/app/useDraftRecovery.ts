import { useCallback, useEffect, useRef, useState } from "react";
import type { Draft, Project, Session } from "../lib/types";
import {
  DraftStore,
  openIndexedDb,
  projectLocation,
  type StoredDraft,
} from "./draftStore";

/** Quiet period after the last keystroke before drafts reach the profile. */
const PERSIST_DELAY = 400;

let shared: Promise<DraftStore> | null = null;
function draftStore() {
  shared ??= openIndexedDb().then((backend) => new DraftStore(backend));
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
      const found = await store.load(root, location);
      if (!active) return;
      const files = projectRef.current?.files ?? [];
      const offered: StoredDraft[] = [];
      for (const entry of found) {
        if (store.owns(entry.key) || draftsRef.current[entry.file]) continue;
        // Nothing to recover when the file already has the draft's text.
        if (files.find((f) => f.path === entry.file)?.content === entry.content)
          void store.discard(entry.key);
        else offered.push(entry);
      }
      setOffers(offered);
    });
    return () => {
      active = false;
    };
  }, [root, location, projectId]);

  // Typing a new draft for a file replaces what was stored for it.
  useEffect(() => {
    setOffers((current) =>
      current.some((entry) => drafts[entry.file])
        ? current.filter((entry) => !drafts[entry.file])
        : current,
    );
  }, [drafts]);

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
  return { offers, restore, discard };
}
