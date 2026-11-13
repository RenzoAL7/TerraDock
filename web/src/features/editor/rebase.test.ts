import { describe, expect, it } from "vitest";
import { rebase, splitLines } from "./rebase";

const base = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16"
}

resource "aws_subnet" "app" {
  vpc_id     = aws_vpc.main.id
  cidr_block = "10.0.1.0/24"
}

resource "aws_instance" "web" {
  ami           = var.ami_id
  instance_type = "t3.micro"
}
`;

describe("rebase", () => {
  it("keeps my change and the change made on disk when they are apart", () => {
    const mine = base.replace('"t3.micro"', '"t3.medium"');
    const disk = base.replace("10.0.1.0/24", "10.0.9.0/24");
    expect(rebase(base, mine, disk)).toEqual({
      clean: true,
      text: base
        .replace('"t3.micro"', '"t3.medium"')
        .replace("10.0.1.0/24", "10.0.9.0/24"),
    });
  });

  it("merges insertions and deletions on both sides", () => {
    const mine =
      base.replace("  ami           = var.ami_id\n", "") +
      '\noutput "id" {\n  value = aws_instance.web.id\n}\n';
    const disk = "# Red principal\n" + base;
    const result = rebase(base, mine, disk);
    expect(result.clean).toBe(true);
    expect(result.text.startsWith("# Red principal\n")).toBe(true);
    expect(result.text).not.toContain("var.ami_id");
    expect(result.text).toContain('output "id"');
  });

  it("accepts the same change made on both sides once", () => {
    const same = base.replace('"t3.micro"', '"t3.large"');
    expect(rebase(base, same, same)).toEqual({ clean: true, text: same });
  });

  it("returns the other side when only one side changed", () => {
    const mine = base.replace('"t3.micro"', '"t3.large"');
    expect(rebase(base, mine, base)).toEqual({ clean: true, text: mine });
    expect(rebase(base, base, mine)).toEqual({ clean: true, text: mine });
  });

  it("never resolves changes to the same line silently", () => {
    const mine = base.replace('"t3.micro"', '"t3.medium"');
    const disk = base.replace('"t3.micro"', '"t3.large"');
    const result = rebase(base, mine, disk);
    expect(result.clean).toBe(false);
    expect(result).toMatchObject({ conflicts: 1 });
    expect(result.text).toContain(
      '<<<<<<< tu borrador\n  instance_type = "t3.medium"\n=======\n  instance_type = "t3.large"\n>>>>>>> disco\n',
    );
    // Everything outside the conflict is the shared text.
    expect(result.text.startsWith('resource "aws_vpc" "main" {\n')).toBe(true);
  });

  it("treats adjacent line changes as a conflict", () => {
    const mine = base.replace("var.ami_id", "var.other");
    const disk = base.replace('"t3.micro"', '"t3.large"');
    expect(rebase(base, mine, disk).clean).toBe(false);
  });

  it("handles files without a final newline", () => {
    const start = "a\nb\nc\nd";
    expect(rebase(start, "A\nb\nc\nd", "a\nb\nc\nD")).toEqual({
      clean: true,
      text: "A\nb\nc\nD",
    });
    expect(splitLines("a\nb")).toEqual(["a\n", "b"]);
  });

  it("stays fast on large files with scattered edits", () => {
    const lines = Array.from({ length: 20_000 }, (_, i) => `line ${i}\n`);
    const big = lines.join("");
    const mine = lines.map((l, i) => (i % 1000 === 0 ? `mine ${i}\n` : l));
    const disk = lines.map((l, i) => (i % 1000 === 500 ? `disk ${i}\n` : l));
    const started = performance.now();
    const result = rebase(big, mine.join(""), disk.join(""));
    expect(performance.now() - started).toBeLessThan(500);
    expect(result.clean).toBe(true);
    expect(result.text).toContain("mine 0\n");
    expect(result.text).toContain("disk 19500\n");
  });

  it("reports a conflict instead of diffing completely different files", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}\n`).join("");
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}\n`).join("");
    const c = Array.from({ length: 3000 }, (_, i) => `c${i}\n`).join("");
    expect(rebase(a, b, c).clean).toBe(false);
  });
});
