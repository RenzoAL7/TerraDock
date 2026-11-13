import { describe, expect, it } from "vitest";
import { SaveQueue } from "./saveQueue";

function gate() {
  let open!: () => void;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { open, opened };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SaveQueue", () => {
  it("runs a save asked for during another one right after it", async () => {
    const seen: string[][] = [];
    const queue = new SaveQueue((paths) => seen.push([...paths]));
    const order: string[] = [];
    const first = gate();
    const running = queue.request("a.tf", async () => {
      order.push("a:start");
      await first.opened;
      order.push("a:end");
    });
    await queue.request("b.tf", async () => {
      order.push("b");
    });
    // b waits: it is reported as pending, not dropped.
    expect(order).toEqual(["a:start"]);
    expect(seen).toEqual([["b.tf"]]);
    first.open();
    await running;
    await settle();
    expect(order).toEqual(["a:start", "a:end", "b"]);
    expect(seen.at(-1)).toEqual([]);
  });

  it("keeps one pending save per file and runs it even if the first fails", async () => {
    const queue = new SaveQueue();
    const first = gate();
    const saved: string[] = [];
    const running = queue.request("a.tf", async () => {
      await first.opened;
      throw new Error("conflicto");
    });
    await queue.request("b.tf", async () => {
      saved.push("b old");
    });
    await queue.request("b.tf", async () => {
      saved.push("b new");
    });
    first.open();
    await expect(running).rejects.toThrow("conflicto");
    await settle();
    expect(saved).toEqual(["b new"]);
  });

  it("does not leave an unhandled rejection when a queued save fails", async () => {
    const unhandled: unknown[] = [];
    const track = (reason: unknown) => unhandled.push(reason);
    process.on("unhandledRejection", track);
    try {
      const queue = new SaveQueue();
      const first = gate();
      const running = queue.request("a.tf", () => first.opened);
      await queue.request("b.tf", async () => {
        throw new Error("sin conexión");
      });
      first.open();
      await running;
      await settle();
      await settle();
      expect(unhandled).toEqual([]);
    } finally {
      process.off("unhandledRejection", track);
    }
  });
});
