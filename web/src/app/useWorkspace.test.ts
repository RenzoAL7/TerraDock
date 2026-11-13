import { afterEach, describe, expect, it } from "vitest";
import { DraftPresence } from "./useWorkspace";

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
