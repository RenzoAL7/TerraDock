import { describe, expect, it } from "vitest";
import { afterFileSave, afterPropertySave } from "./drafts";
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
    expect(result["main.tf"]).toEqual({ ...typed, baseRevision: "new" });
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
  it("allows consecutive property saves in one file without weakening conflict detection", () => {
    const sent: PropertyDraft = {
      projectId: "p",
      revision: "old",
      text: "medium",
    };
    const pending = { ...sent, text: "new description" };
    const before = snapshot("old"),
      after = snapshot("new");
    after.resources = [
      {
        ...resource,
        properties: [
          { ...property, expression: '"medium"', value: "medium" },
          other,
        ],
      },
    ];
    expect(
      afterPropertySave(
        {
          "aws_instance.web:instance_type": sent,
          "aws_instance.web:description": pending,
        },
        resource,
        property,
        sent,
        before,
        after,
      ),
    ).toEqual({
      "aws_instance.web:description": { ...pending, revision: "new" },
    });
    after.resources[0].properties[1] = {
      ...other,
      expression: '"externally modified"',
    };
    expect(
      afterPropertySave(
        { "aws_instance.web:description": pending },
        resource,
        property,
        sent,
        before,
        after,
      )["aws_instance.web:description"].revision,
    ).toBe("old");
  });
});
