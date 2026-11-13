import { describe, expect, it } from "vitest";
import { afterFileSave, settledProperties, withDraft } from "./drafts";
import type { Draft, Project, Property, Resource } from "../lib/types";
import type { PropertyDraft } from "../features/inspector/Inspector";

const property = {
  name: "instance_type",
  expression: '"small"',
  value: "small",
  editable: true,
  kind: "literal",
  line: 2,
} satisfies Property;
const other = {
  ...property,
  name: "description",
  expression: '"before"',
  value: "before",
};
const resource = {
  id: "aws_instance.web",
  block: "resource",
  type: "aws_instance",
  file: "main.tf",
  properties: [property, other],
  name: "web",
  label: "web",
  category: "compute",
  line: 1,
  dependsOn: [],
} satisfies Resource;
const snapshot = (revision: string): Project => ({
  id: "p",
  name: "p",
  mode: "demo",
  path: "",
  revision,
  files: [{ path: "main.tf", content: "", revision }],
  resources: [resource],
  edges: [],
  diagnostics: [],
  findings: [],
  valid: true,
  sequence: 1,
  instanceId: "test",
});

describe("in-flight edits", () => {
  const captured: Draft = {
    projectId: "p",
    baseRevision: "old",
    baseContent: "",
    content: "saved",
  };
  it("keeps typing made during a save and advances only its known baseline", () => {
    const typed = { ...captured, content: "new typing" };
    const result = afterFileSave(
      { "main.tf": typed },
      "main.tf",
      captured,
      snapshot("new"),
    );
    expect(result["main.tf"]).toEqual({
      ...typed,
      baseRevision: "new",
      baseContent: "",
    });
    expect(typed.baseRevision).toBe("old");
  });
  it("clears the exact saved draft without discarding another file", () => {
    expect(
      afterFileSave(
        { "main.tf": captured, "other.tf": captured },
        "main.tf",
        captured,
        snapshot("new"),
      ),
    ).toEqual({ "other.tf": captured });
  });
  it("does not rebase a draft from another project or a new external baseline", () => {
    for (const changed of [
      { ...captured, projectId: "other" },
      { ...captured, baseRevision: "external" },
    ])
      expect(
        afterFileSave(
          { "main.tf": changed },
          "main.tf",
          captured,
          snapshot("new"),
        )["main.tf"],
      ).toEqual(changed);
  });
});

describe("live inspector edits", () => {
  const key = "aws_instance.web:instance_type";
  it("drops text once the live view reflects it", () => {
    const typed: PropertyDraft = { projectId: "p", text: "small" };
    expect(settledProperties({ [key]: typed }, [resource], "p")).toEqual({});
  });
  it("keeps text that is still being applied", () => {
    const typed: PropertyDraft = { projectId: "p", text: "large" };
    const current = { [key]: typed };
    expect(settledProperties(current, [resource], "p")).toBe(current);
  });
  it("drops text from another project or for fields that disappeared", () => {
    const typed: PropertyDraft = { projectId: "old", text: "large" };
    expect(settledProperties({ [key]: typed }, [resource], "p")).toEqual({});
    expect(
      settledProperties({ [key]: { ...typed, projectId: "p" } }, [], "p"),
    ).toEqual({});
  });
});

describe("withDraft", () => {
  const saved = { content: "disk", revision: "r1" };
  it("creates a draft based on the saved revision", () => {
    expect(withDraft({}, "main.tf", "typed", saved, "p")).toEqual({
      "main.tf": {
        content: "typed",
        baseRevision: "r1",
        baseContent: "disk",
        projectId: "p",
      },
    });
  });
  it("keeps the original baseline while typing and clears on match", () => {
    const first = withDraft({}, "main.tf", "a", saved, "p");
    const second = withDraft(
      first,
      "main.tf",
      "ab",
      { ...saved, revision: "r2" },
      "p",
    );
    expect(second["main.tf"].baseRevision).toBe("r1");
    expect(second["main.tf"].baseContent).toBe("disk");
    expect(withDraft(second, "main.tf", "disk", saved, "p")).toEqual({});
  });
});
