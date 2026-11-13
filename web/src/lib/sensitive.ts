import type { BlockKind, Property, Resource } from "./types";

/** Shown instead of a value Terraform would redact. */
export const SENSITIVE_TEXT = "(sensible)";

/** The property that holds the value of each kind of declaration. */
const valueProperty: Partial<Record<BlockKind, string>> = {
  variable: "default",
  output: "value",
  local: "value",
};

/**
 * Whether a variable or output declares `sensitive = true`, or a local wraps
 * its value in `sensitive(...)` (locals have no `sensitive` argument).
 */
export function isSensitive(resource: Resource): boolean {
  if (resource.block === "local") {
    const value = resource.properties.find((p) => p.name === "value");
    return !!value && /^\s*sensitive\s*\(/.test(value.expression);
  }
  if (resource.block !== "variable" && resource.block !== "output")
    return false;
  return resource.properties.some(
    (p) => p.name === "sensitive" && p.value === true,
  );
}

/** Whether `property` is the value a sensitive declaration must not show. */
export function hidesValue(resource: Resource, property: Property): boolean {
  return (
    valueProperty[resource.block] === property.name && isSensitive(resource)
  );
}
