import { describe, expect, it } from "vitest";
import {
  DRAFT_TTL,
  DraftStore,
  groupOffers,
  projectLocation,
  recoverable,
  storageKey,
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
    const store = new DraftStore(backend, () => now, "tab-a");
    await store.persist("/root", { "main.tf": draft("typed") }, locations);
    expect([...entries.keys()]).toEqual([
      storageKey("/root", "/root/app", "main.tf", "tab-a"),
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
    const store = new DraftStore(backend, Date.now, "tab-a");
    await store.persist(
      "/root",
      { "main.tf": draft("a"), "net.tf": draft("b") },
      locations,
    );
    expect(entries.size).toBe(2);
    await store.persist("/root", { "net.tf": draft("b") }, locations);
    expect([...entries.values()].map((e) => e.file)).toEqual(["net.tf"]);
    await store.discard(storageKey("/root", "/root/app", "net.tf", "tab-a"));
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

  it("keeps the draft of another open tab when this tab writes or drops one of the same file", async () => {
    const { entries, backend } = memory();
    const c = new DraftStore(backend, Date.now, "tab-c");
    const d = new DraftStore(backend, Date.now, "tab-d");
    await d.persist("/root", { "main.tf": draft("from D") }, locations);
    await c.persist("/root", { "main.tf": draft("from C") }, locations);
    expect([...entries.values()].map((e) => [e.tab, e.content]).sort()).toEqual(
      [
        ["tab-c", "from C"],
        ["tab-d", "from D"],
      ],
    );
    // C saves its file: only C's copy goes away.
    await c.persist("/root", {}, locations);
    expect([...entries.values()].map((e) => e.content)).toEqual(["from D"]);
  });

  it("restoring another tab's draft moves it under this tab's key", async () => {
    const { entries, backend } = memory();
    await new DraftStore(backend, Date.now, "closed").persist(
      "/root",
      { "main.tf": draft("left") },
      locations,
    );
    const store = new DraftStore(backend, Date.now, "new");
    const [entry] = await store.load("/root", "/root/app");
    store.adopt(entry);
    await store.persist("/root", { "main.tf": draft("left") }, locations);
    expect([...entries.values()].map((e) => e.tab)).toEqual(["new"]);
  });

  it("groups the drafts of the same file, newest first", () => {
    const entry = (file: string, savedAt: number, tab: string) =>
      ({ key: `${file}-${tab}`, file, savedAt, tab }) as StoredDraft;
    expect(
      groupOffers([
        entry("main.tf", 1, "a"),
        entry("net.tf", 2, "a"),
        entry("main.tf", 3, "b"),
      ]).map((g) => [g.file, g.entries.map((e) => e.tab)]),
    ).toEqual([
      ["main.tf", ["b", "a"]],
      ["net.tf", ["a"]],
    ]);
    expect(groupOffers([])).toEqual([]);
  });

  it("clears stored drafts of other tabs but keeps this tab's open ones", async () => {
    const { entries, backend } = memory();
    await new DraftStore(backend, Date.now, "closed").persist(
      "/root",
      { "main.tf": draft("left"), "net.tf": draft("left too") },
      locations,
    );
    const store = new DraftStore(backend, Date.now, "open");
    await store.persist("/root", { "main.tf": draft("mine") }, locations);
    expect(await store.clear()).toBe(2);
    expect([...entries.values()].map((e) => e.content)).toEqual(["mine"]);
    expect(await new DraftStore(null).clear()).toBe(0);
  });

  it("does not clear the copies of tabs that are still open", async () => {
    const { entries, backend } = memory();
    await new DraftStore(backend, Date.now, "open").persist(
      "/root",
      { "main.tf": draft("other tab") },
      locations,
    );
    await new DraftStore(backend, Date.now, "closed").persist(
      "/root",
      { "net.tf": draft("left") },
      locations,
    );
    const store = new DraftStore(backend, Date.now, "me");
    expect(await store.clear(new Set(["open"]))).toBe(1);
    expect([...entries.values()].map((e) => e.tab)).toEqual(["open"]);
  });

  it("never expires the draft of a tab that is still open", async () => {
    const { entries, backend } = memory();
    let now = 0;
    await new DraftStore(backend, () => now, "open").persist(
      "/root",
      { "main.tf": draft("old but open") },
      locations,
    );
    now = DRAFT_TTL + 1;
    const store = new DraftStore(backend, () => now, "me");
    expect(await store.load("/root", "/root/app", new Set(["open"]))).toEqual([
      expect.objectContaining({ tab: "open" }),
    ]);
    expect(entries.size).toBe(1);
  });

  it("offers only drafts of tabs not heard from, and forgets ones already on disk", () => {
    const entry = (tab: string | undefined, file: string, content: string) =>
      ({
        key: `${tab}-${file}`,
        tab,
        file,
        content,
        savedAt: 1,
      }) as StoredDraft;
    const found = [
      entry("mine", "main.tf", "x"),
      entry("open", "main.tf", "y"),
      entry("closed", "main.tf", "z"),
      entry("closed", "net.tf", "on disk"),
      entry(undefined, "old.tf", "legacy"),
    ];
    const { offers, stale } = recoverable(found, {
      tab: "mine",
      owns: () => false,
      heard: new Set(["open"]),
      files: [{ path: "net.tf", content: "on disk" }],
    });
    expect(offers.map((e) => e.key)).toEqual([
      "closed-main.tf",
      "undefined-old.tf",
    ]);
    expect(stale.map((e) => e.key)).toEqual(["closed-net.tf"]);
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
