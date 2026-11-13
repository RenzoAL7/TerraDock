import { describe, expect, it } from "vitest";
import { hidesValue, isSensitive } from "./sensitive";
import type { Property, Resource } from "./types";

const prop = (
  name: string,
  expression: string,
  value?: Property["value"],
): Property => ({
  name,
  expression,
  value,
  kind: value === undefined ? "expression" : "literal",
  editable: false,
  line: 1,
});
const decl = (block: Resource["block"], properties: Property[]) =>
  ({ id: "x", block, properties }) as unknown as Resource;

describe("sensitive values", () => {
  it("hides the default of a sensitive variable and the value of an output", () => {
    const variable = decl("variable", [
      prop("default", '"s3cr3t"', "s3cr3t"),
      prop("sensitive", "true", true),
      prop("description", '"clave"', "clave"),
    ]);
    expect(isSensitive(variable)).toBe(true);
    expect(hidesValue(variable, variable.properties[0])).toBe(true);
    // Only the value is hidden, not the rest of the declaration.
    expect(hidesValue(variable, variable.properties[2])).toBe(false);
    const output = decl("output", [
      prop("value", "aws_db_instance.main.password"),
      prop("sensitive", "true", true),
    ]);
    expect(hidesValue(output, output.properties[0])).toBe(true);
  });

  it("treats a local wrapped in sensitive() as sensitive", () => {
    const local = decl("local", [prop("value", 'sensitive("token")')]);
    expect(hidesValue(local, local.properties[0])).toBe(true);
    const plain = decl("local", [prop("value", '"sensitive(not a call)"')]);
    expect(isSensitive(plain)).toBe(false);
  });

  it("shows values without sensitive = true, or of other blocks", () => {
    const off = decl("variable", [
      prop("default", '"dev"', "dev"),
      prop("sensitive", "false", false),
    ]);
    expect(hidesValue(off, off.properties[0])).toBe(false);
    const resource = decl("resource", [
      prop("value", '"x"', "x"),
      prop("sensitive", "true", true),
    ]);
    expect(isSensitive(resource)).toBe(false);
  });
});
