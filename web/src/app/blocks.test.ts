import { describe, expect, it } from "vitest";
import { blockEnd, declarationEnd, resourceAtLine } from "./blocks";
import type { Resource } from "../lib/types";

const source = `resource "aws_vpc" "main" {
  cidr_block = "10.0.0.0/16" # { not a brace
  tags = { Name = "}" }
}

resource "aws_subnet" "a" {
  vpc_id = aws_vpc.main.id
  /* } */
}
`;
const r = (id: string, line: number) =>
  ({ id, file: "main.tf", line }) as Resource;

describe("blockEnd", () => {
  it("ignores braces in strings and comments", () => {
    expect(blockEnd(source, 1)).toBe(4);
    expect(blockEnd(source, 6)).toBe(9);
  });
  it("falls back to the start line for unterminated blocks", () => {
    expect(blockEnd('resource "x" "y" {\n  a = 1\n', 1)).toBe(1);
  });
});

describe("resourceAtLine", () => {
  const resources = [r("aws_vpc.main", 1), r("aws_subnet.a", 6)];
  it("finds the enclosing resource", () => {
    expect(resourceAtLine(resources, "main.tf", source, 3)?.id).toBe(
      "aws_vpc.main",
    );
    expect(resourceAtLine(resources, "main.tf", source, 8)?.id).toBe(
      "aws_subnet.a",
    );
  });
  it("returns nothing between blocks or in other files", () => {
    expect(resourceAtLine(resources, "main.tf", source, 5)).toBeUndefined();
    expect(resourceAtLine(resources, "other.tf", source, 3)).toBeUndefined();
  });
});

describe("resourceAtLine with parser ranges", () => {
  // Same source as TestLocalsGiveOneNodePerKey; ranges as the parser sends them.
  const locals = `locals {
  prefix = "app"
  name   = "\${local.prefix}-\${var.env}"
}
locals {
  cidr = "10.0.0.0/16"
}
variable "env" {}
resource "aws_vpc" "main" {
  cidr_block = local.cidr
  tags       = { Name = local.name }
}
`;
  const at = (id: string, line: number, endLine: number) =>
    ({
      id,
      block: id.startsWith("local.")
        ? "local"
        : id.startsWith("var.")
          ? "variable"
          : "resource",
      file: "main.tf",
      line,
      endLine,
    }) as Resource;
  const parsed = [
    at("local.prefix", 2, 2),
    at("local.name", 3, 3),
    at("local.cidr", 6, 6),
    at("var.env", 8, 8),
    at("aws_vpc.main", 9, 12),
  ];
  it("selects each local only on its own lines", () => {
    expect(resourceAtLine(parsed, "main.tf", locals, 3)?.id).toBe("local.name");
    expect(resourceAtLine(parsed, "main.tf", locals, 6)?.id).toBe("local.cidr");
    expect(resourceAtLine(parsed, "main.tf", locals, 11)?.id).toBe(
      "aws_vpc.main",
    );
  });
  it("does not select another local from the second locals block", () => {
    expect(resourceAtLine(parsed, "main.tf", locals, 5)).toBeUndefined();
    expect(resourceAtLine(parsed, "main.tf", locals, 7)).toBeUndefined();
  });
});

describe("declarationEnd", () => {
  it("measures blocks on the current text, not on a stale analysis", () => {
    // The last valid analysis said the VPC ended at line 4; the user has
    // since added lines and the HCL may be invalid elsewhere.
    const vpc = {
      id: "aws_vpc.main",
      block: "resource",
      line: 1,
      endLine: 2,
    } as Resource;
    expect(declarationEnd(vpc, source)).toBe(4);
  });
  it("uses the parser range for a local, and falls back without one", () => {
    const local = { id: "local.a", block: "local", line: 2, endLine: 3 };
    expect(declarationEnd(local as Resource, source)).toBe(3);
    const old = { id: "aws_vpc.main", block: "resource", line: 1 };
    expect(declarationEnd(old as Resource, source)).toBe(4);
  });
});
