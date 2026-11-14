import { describe, expect, it } from "vitest";
import { PendingReveal, REVEAL_WAIT_MS } from "./reveal";

describe("PendingReveal", () => {
  it("reveals at once a line the model already has", () => {
    const reveal = new PendingReveal();
    expect(reveal.request(3, 10)).toBe(3);
    // Nothing left waiting.
    expect(reveal.take(20)).toBe(0);
  });

  it("waits for a line the next sync adds, and reveals it once", () => {
    const reveal = new PendingReveal();
    expect(reveal.request(14, 9)).toBe(0);
    expect(reveal.take(9)).toBe(0);
    expect(reveal.take(16)).toBe(14);
    expect(reveal.take(16)).toBe(0);
  });

  it("a newer request replaces the waiting one; line 0 cancels it", () => {
    const reveal = new PendingReveal();
    reveal.request(30, 10);
    expect(reveal.request(5, 10)).toBe(5);
    expect(reveal.take(40)).toBe(0);
    reveal.request(30, 10);
    expect(reveal.request(0, 10)).toBe(0);
    expect(reveal.take(40)).toBe(0);
  });

  it("gives up on a line that never arrives", () => {
    const reveal = new PendingReveal();
    expect(reveal.request(50, 10, 1_000)).toBe(0);
    expect(reveal.take(60, 1_000 + REVEAL_WAIT_MS + 1)).toBe(0);
    expect(reveal.take(60, 1_000 + REVEAL_WAIT_MS + 2)).toBe(0);
  });
});
