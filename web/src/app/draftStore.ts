import type { Draft, Project } from "../lib/types";

/** Drafts older than this are dropped the next time the store is read. */
export const DRAFT_TTL = 7 * 24 * 60 * 60 * 1000;

/**
 * A draft kept in the browser profile so it survives closing or reloading the
 * tab. It belongs to one file of one project folder of one TerraDock root.
 */
export interface StoredDraft {
  key: string;
  /** Tab that wrote it; absent in entries written before tabs were told apart. */
  tab?: string;
  instanceRoot: string;
  /** Project folder for local projects, or the example id. */
  projectPath: string;
  file: string;
  content: string;
  /** Revision and text of the file the draft started from. */
  baseRevision: string;
  baseContent: string;
  savedAt: number;
}

export interface DraftBackend {
  all(): Promise<StoredDraft[]>;
  put(entry: StoredDraft): Promise<void>;
  remove(key: string): Promise<void>;
}

/** Identity of a file across tabs: root, project folder and file. */
export function draftKey(
  instanceRoot: string,
  projectPath: string,
  file: string,
) {
  return JSON.stringify([instanceRoot, projectPath, file]);
}

/**
 * Where one tab keeps its draft of a file. Each tab writes its own entry, so
 * two open tabs never overwrite or delete each other's copy.
 */
export function storageKey(
  instanceRoot: string,
  projectPath: string,
  file: string,
  tab: string,
) {
  return JSON.stringify([instanceRoot, projectPath, file, tab]);
}

export function newTabId() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** This page's tab: shared by the draft store and the presence channel. */
export const TAB_ID = newTabId();

/** Stored drafts of the same file (one per tab that left it), newest first. */
export interface DraftOffer {
  file: string;
  entries: StoredDraft[];
}

/**
 * Split what `load` found into drafts to offer and copies to forget because
 * the file already has that text. Entries this tab wrote, and entries of any
 * tab heard from during this page's life (it may still be open), are neither
 * offered nor removed.
 */
export function recoverable(
  found: readonly StoredDraft[],
  context: {
    tab: string;
    owns: (key: string) => boolean;
    heard: ReadonlySet<string>;
    files: readonly { path: string; content: string }[];
  },
) {
  const offers: StoredDraft[] = [];
  const stale: StoredDraft[] = [];
  for (const entry of found) {
    if (context.owns(entry.key) || entry.tab === context.tab) continue;
    if (entry.tab !== undefined && context.heard.has(entry.tab)) continue;
    const file = context.files.find((f) => f.path === entry.file);
    if (file?.content === entry.content) stale.push(entry);
    else offers.push(entry);
  }
  return { offers, stale };
}

/** Group entries by file, newest file and newest entry first. */
export function groupOffers(entries: readonly StoredDraft[]): DraftOffer[] {
  const byFile = new Map<string, StoredDraft[]>();
  for (const entry of [...entries].sort((a, b) => b.savedAt - a.savedAt)) {
    const list = byFile.get(entry.file);
    if (list) list.push(entry);
    else byFile.set(entry.file, [entry]);
  }
  return [...byFile].map(([file, list]) => ({ file, entries: list }));
}

/** Where a project lives: its folder, or the example id (examples have none). */
export function projectLocation(
  project: Pick<Project, "mode" | "path" | "id">,
) {
  return project.mode === "local" ? project.path : project.id;
}

/**
 * Mirrors one tab's drafts into a backend. Every method degrades to a no-op
 * when the backend is missing or fails (private mode, storage disabled), so
 * persistence never interrupts editing.
 */
export class DraftStore {
  /** What this tab wrote, so removing a draft here removes it from storage. */
  private written = new Map<string, StoredDraft>();
  /** Writes run one after another so a slow write never lands after a newer one. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private backend: DraftBackend | null,
    private now: () => number = Date.now,
    readonly tab: string = newTabId(),
  ) {}

  get available() {
    return this.backend !== null;
  }

  /**
   * Drafts saved for a project, newest first, after dropping expired ones.
   * Entries of `keepTabs` (tabs still open) are never dropped here.
   */
  async load(
    instanceRoot: string,
    projectPath: string,
    keepTabs: ReadonlySet<string> = new Set(),
  ) {
    const entries = await this.attempt(() => this.backend!.all(), []);
    const limit = this.now() - DRAFT_TTL;
    const found: StoredDraft[] = [];
    for (const entry of entries) {
      const open = entry.tab !== undefined && keepTabs.has(entry.tab);
      if (!(entry.savedAt >= limit) && !open) {
        await this.attempt(() => this.backend!.remove(entry.key), undefined);
        continue;
      }
      if (
        entry.instanceRoot === instanceRoot &&
        entry.projectPath === projectPath
      )
        found.push(entry);
    }
    return found.sort((a, b) => b.savedAt - a.savedAt);
  }

  /**
   * Write new or changed drafts and remove the ones this tab dropped (saved
   * or discarded). `locations` maps each draft's project id to its folder.
   */
  persist(
    instanceRoot: string,
    drafts: Record<string, Draft>,
    locations: ReadonlyMap<string, string>,
  ) {
    return this.serial(() => this.write(instanceRoot, drafts, locations));
  }

  private async write(
    instanceRoot: string,
    drafts: Record<string, Draft>,
    locations: ReadonlyMap<string, string>,
  ) {
    const next = new Map<string, StoredDraft>();
    for (const [file, draft] of Object.entries(drafts)) {
      const projectPath = locations.get(draft.projectId);
      if (projectPath === undefined) continue;
      const key = storageKey(instanceRoot, projectPath, file, this.tab);
      const previous = this.written.get(key);
      if (
        previous &&
        previous.content === draft.content &&
        previous.baseRevision === draft.baseRevision
      ) {
        next.set(key, previous);
        continue;
      }
      const entry: StoredDraft = {
        key,
        tab: this.tab,
        instanceRoot,
        projectPath,
        file,
        content: draft.content,
        baseRevision: draft.baseRevision,
        baseContent: draft.baseContent,
        savedAt: this.now(),
      };
      next.set(key, entry);
      await this.attempt(() => this.backend!.put(entry), undefined);
    }
    // Only this tab's entries (and ones it restored) are removed here.
    for (const key of this.written.keys())
      if (!next.has(key))
        await this.attempt(() => this.backend!.remove(key), undefined);
    this.written = next;
  }

  /**
   * Remove every stored draft of this browser profile except the ones this
   * tab is keeping for its open drafts and those of `keepTabs` (other tabs
   * still open). Resolves to how many were removed.
   */
  clear(keepTabs: ReadonlySet<string> = new Set()) {
    return this.serial(async () => {
      const entries = await this.attempt(() => this.backend!.all(), []);
      let removed = 0;
      for (const entry of entries) {
        if (this.written.has(entry.key)) continue;
        if (entry.tab !== undefined && keepTabs.has(entry.tab)) continue;
        await this.attempt(() => this.backend!.remove(entry.key), undefined);
        if (!this.backend) break;
        removed++;
      }
      return removed;
    });
  }

  /** Forget a stored draft the user declined to restore. */
  discard(key: string) {
    this.written.delete(key);
    return this.serial(() =>
      this.attempt(() => this.backend!.remove(key), undefined),
    );
  }

  private serial<T>(work: () => Promise<T>): Promise<T> {
    const job = this.queue.then(work);
    this.queue = job.catch(() => undefined);
    return job;
  }

  /** Whether this tab wrote the entry (it is not a draft left by another). */
  owns(key: string) {
    return this.written.has(key);
  }

  /** Treat a restored entry as written by this tab. */
  adopt(entry: StoredDraft) {
    this.written.set(entry.key, entry);
  }

  private async attempt<T>(work: () => Promise<T>, fallback: T): Promise<T> {
    if (!this.backend) return fallback;
    try {
      return await work();
    } catch {
      // Storage can disappear mid-session (quota, cleared site data).
      this.backend = null;
      return fallback;
    }
  }
}

const DB_NAME = "terradock";
const STORE = "drafts";

function done<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB"));
  });
}

/** IndexedDB backend, or null when the browser does not allow it. */
export async function openIndexedDb(): Promise<DraftBackend | null> {
  try {
    if (typeof indexedDB === "undefined") return null;
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => {
      if (!open.result.objectStoreNames.contains(STORE))
        open.result.createObjectStore(STORE, { keyPath: "key" });
    };
    const db = await done(open);
    const store = (mode: IDBTransactionMode) =>
      db.transaction(STORE, mode).objectStore(STORE);
    return {
      all: () => done(store("readonly").getAll() as IDBRequest<StoredDraft[]>),
      put: async (entry) => {
        await done(store("readwrite").put(entry));
      },
      remove: async (key) => {
        await done(store("readwrite").delete(key));
      },
    };
  } catch {
    return null;
  }
}
