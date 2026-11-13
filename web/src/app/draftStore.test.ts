import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL,
  DraftStore,
  draftKey,
  projectLocation,
  type DraftBackend,
  type StoredDraft,
} from "./draftStore";
import type { Draft } from "../lib/types";

function memory() {
  const entries = new Map<string, StoredDraft>();
  const backend: DraftBackend = {
    all: async () => [...entries.values()],
    put: async (entry) => {
      entries.set(entry.key, entry);
    },
    remove: async (key) => {
      entries.delete(key);
    },
  };
  return { entries, backend };
}

const draft = (content: string, baseRevision = "r1"): Draft => ({
  projectId: "local-a",
  content,
  baseRevision,
  baseContent: "disk",
});
const locations = new Map([["local-a", "/root/app"]]);

describe("DraftStore", () => {
  it("keeps a draft per root, project folder and file, and finds it again", async () => {
    const { entries, backend } = memory();
    let now = 1_000;
    const store = new DraftStore(backend, () => now);
    await store.persist("/root", { "main.tf": draft("typed") }, locations);
    expect([...entries.keys()]).toEqual([
      draftKey("/root", "/root/app", "main.tf"),
    ]);
    now = 2_000;
    // A new tab (a reload) reads what the previous one wrote.
    const found = await new DraftStore(backend, () => now).load(
      "/root",
      "/root/app",
    );
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      file: "main.tf",
      content: "typed",
      baseRevision: "r1",
      baseContent: "disk",
      savedAt: 1_000,
    });
    expect(await store.load("/other-root", "/root/app")).toEqual([]);
    expect(await store.load("/root", "/root/other")).toEqual([]);
  });

  it("removes the entry once the draft is saved or discarded", async () => {
    const { entries, backend } = memory();
    const store = new DraftStore(backend);
    await store.persist(
      "/root",
      { "main.tf": draft("a"), "net.tf": draft("b") },
      locations,
    );
    expect(entries.size).toBe(2);
    await store.persist("/root", { "net.tf": draft("b") }, locations);
    expect([...entries.values()].map((e) => e.file)).toEqual(["net.tf"]);
    await store.discard(draftKey("/root", "/root/app", "net.tf"));
    expect(entries.size).toBe(0);
  });

  it("does not delete drafts left by a previous tab until they are handled", async () => {
    const { entries, backend } = memory();
    await new DraftStore(backend).persist(
      "/root",
      { "main.tf": draft("old") },
      locations,
    );
    // The reloaded tab starts with no drafts in memory.
    await new DraftStore(backend).persist("/root", {}, locations);
    expect(entries.size).toBe(1);
  });

  it("drops drafts older than seven days when reading", async () => {
    const { entries, backend } = memory();
    let now = 0;
    const store = new DraftStore(backend, () => now);
    await store.persist("/root", { "main.tf": draft("old") }, locations);
    now = DRAFT_TTL;
    expect(await store.load("/root", "/root/app")).toHaveLength(1);
    now = DRAFT_TTL + 1;
    expect(await store.load("/root", "/root/app")).toEqual([]);
    expect(entries.size).toBe(0);
  });

  it("only rewrites a draft whose text or base changed", async () => {
    const { backend } = memory();
    let puts = 0;
    const counting = {
      ...backend,
      put: (entry: StoredDraft) => {
        puts++;
        return backend.put(entry);
      },
    };
    const store = new DraftStore(counting);
    const same = draft("a");
    await store.persist("/root", { "main.tf": same }, locations);
    await store.persist("/root", { "main.tf": same }, locations);
    await store.persist("/root", { "main.tf": draft("a", "r2") }, locations);
    expect(puts).toBe(2);
  });

  it("keeps working without storage or when storage fails", async () => {
    const none = new DraftStore(null);
    expect(none.available).toBe(false);
    await expect(
      none.persist("/root", { "main.tf": draft("a") }, locations),
    ).resolves.toBeUndefined();
    expect(await none.load("/root", "/root/app")).toEqual([]);

    const broken: DraftBackend = {
      all: () => Promise.reject(new Error("quota")),
      put: () => Promise.reject(new Error("quota")),
      remove: () => Promise.reject(new Error("quota")),
    };
    const store = new DraftStore(broken);
    await expect(
      store.persist("/root", { "main.tf": draft("a") }, locations),
    ).resolves.toBeUndefined();
    expect(store.available).toBe(false);
    expect(await store.load("/root", "/root/app")).toEqual([]);
  });

  it("names examples by id and local projects by folder", () => {
    expect(
      projectLocation({ mode: "demo", path: "", id: "demo-web-app" }),
    ).toBe("demo-web-app");
    expect(projectLocation({ mode: "local", path: "/p", id: "local-x" })).toBe(
      "/p",
    );
  });
});
