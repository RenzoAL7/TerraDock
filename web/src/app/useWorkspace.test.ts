import { afterEach, describe, expect, it } from "vitest";
import { DraftPresence, PRESENCE_WINDOW } from "./useWorkspace";

let open: DraftPresence[] = [];
let channels = 0;

/** A tab: one presence on a fresh channel of the shared name. */
function tab(name: string) {
  let seen: ReadonlySet<string> = new Set();
  const presence = new DraftPresence(new BroadcastChannel(name), (keys) => {
    seen = keys;
  });
  open.push(presence);
  return { presence, seen: () => seen };
}

async function until(check: () => boolean) {
  for (let i = 0; i < 100 && !check(); i++)
    await new Promise((resolve) => setTimeout(resolve, 5));
  expect(check()).toBe(true);
}

afterEach(() => {
  for (const presence of open) presence.close();
  open = [];
});

describe("DraftPresence", () => {
  it("tells other tabs which files have drafts, and when they no longer do", async () => {
    const name = `presence-${++channels}`;
    const a = tab(name);
    const b = tab(name);
    a.presence.publish(["main.tf"]);
    await until(() => b.seen().has("main.tf"));
    // A tab never reports its own drafts back to itself.
    expect(a.seen().size).toBe(0);
    a.presence.publish([]);
    await until(() => b.seen().size === 0);
  });

  it("answers a tab opened later, and forgets a tab that closes", async () => {
    const name = `presence-${++channels}`;
    const a = tab(name);
    a.presence.publish(["net.tf"]);
    const late = tab(name);
    await until(() => late.seen().has("net.tf"));
    a.presence.close();
    await until(() => late.seen().size === 0);
  });

  it("announces its drafts again when the page comes back from the cache", async () => {
    const name = `presence-${++channels}`;
    const a = tab(name);
    const b = tab(name);
    a.presence.publish(["main.tf"]);
    b.presence.publish(["net.tf"]);
    await until(() => b.seen().has("main.tf") && a.seen().has("net.tf"));
    // pagehide closes the channel; pageshow (persisted) reopens it.
    a.presence.close();
    await until(() => b.seen().size === 0);
    a.presence.reopen(new BroadcastChannel(name));
    await until(() => b.seen().has("main.tf"));
    await until(() => a.seen().has("net.tf"));
  });

  it("forgets other tabs when it cannot reopen a channel", async () => {
    const name = `presence-${++channels}`;
    const a = tab(name);
    const b = tab(name);
    b.presence.publish(["net.tf"]);
    await until(() => a.seen().has("net.tf"));
    a.presence.reopen(null);
    expect(a.seen().size).toBe(0);
  });

  it("knows which tabs answered its hello, and which said goodbye", async () => {
    const name = `presence-${++channels}`;
    const a = tab(name);
    a.presence.publish(["main.tf"]);
    const started = Date.now();
    const late = tab(name);
    // Recovery waits for this before offering drafts left in storage.
    await late.presence.settled();
    expect(Date.now() - started).toBeGreaterThanOrEqual(PRESENCE_WINDOW - 5);
    expect(late.presence.heardTabs().has(a.presence.tab)).toBe(true);
    expect(late.presence.liveTabs().has(a.presence.tab)).toBe(true);
    a.presence.close();
    await until(() => !late.presence.liveTabs().has(a.presence.tab));
    // A tab heard during this page's life is still not treated as a leftover.
    expect(late.presence.heardTabs().has(a.presence.tab)).toBe(true);
  });

  it("settles at once without BroadcastChannel", async () => {
    const alone = new DraftPresence(null, () => undefined);
    await alone.settled();
    expect(alone.heardTabs().size).toBe(0);
  });

  it("ignores malformed messages and works without BroadcastChannel", async () => {
    const name = `presence-${++channels}`;
    const b = tab(name);
    const raw = new BroadcastChannel(name);
    raw.postMessage({ kind: "drafts", tab: "x", keys: [1] });
    raw.postMessage("nonsense");
    raw.postMessage({ kind: "drafts", tab: "y", keys: ["ok.tf"] });
    await until(() => b.seen().has("ok.tf"));
    expect(b.seen().size).toBe(1);
    raw.close();

    let calls = 0;
    const alone = new DraftPresence(null, () => calls++);
    alone.publish(["main.tf"]);
    alone.close();
    expect(calls).toBe(0);
  });
});
