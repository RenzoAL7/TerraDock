import { describe, expect, it } from "vitest";
import { minimalEdit } from "./minimalEdit";

const apply = (s: string, e: ReturnType<typeof minimalEdit>) =>
  s.slice(0, e.start) + e.text + s.slice(e.end);

describe("minimalEdit", () => {
  it("replaces only the changed literal", () => {
    const a = 'a = "t3.micro"\nb = 1\n';
    const b = 'a = "t3.large"\nb = 1\n';
    const e = minimalEdit(a, b);
    expect(e).toEqual({ start: 8, end: 13, text: "large" });
    expect(apply(a, e)).toBe(b);
  });
  it("handles insertions, deletions and repeated characters", () => {
    for (const [a, b] of [
      ["", "abc"],
      ["abc", ""],
      ["aaaa", "aaaaaa"],
      ["xaay", "xy"],
      ["same", "same"],
    ])
      expect(apply(a, minimalEdit(a, b))).toBe(b);
  });
});
