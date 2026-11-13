import { describe, expect, it } from "vitest";
import { combineView, draftOverrides } from "./useLivePreview";
import type { Preview, Project, Resource } from "../lib/types";

const res = (id: string) =>
  ({ id, properties: [], dependsOn: [] }) as unknown as Resource;
const project: Project = {
  id: "p",
  instanceId: "i",
  sequence: 1,
  name: "p",
  mode: "demo",
  path: "",
  revision: "r",
  files: [{ path: "main.tf", content: "saved", revision: "r" }],
  resources: [res("saved")],
  edges: [],
  diagnostics: [],
  findings: [],
  valid: true,
};
const preview = (valid: boolean, ids: string[]): Preview => ({
  projectId: "p",
  revision: "r",
  resources: ids.map(res),
  edges: [],
  diagnostics: valid
    ? []
    : [{ severity: "error", message: "x", file: "main.tf", line: 1 }],
  findings: [],
  valid,
});

describe("combineView", () => {
  it("shows saved files when there are no drafts", () => {
    const view = combineView(
      project,
      preview(true, ["draft"]),
      null,
      false,
      false,
    );
    expect(view.resources.map((r) => r.id)).toEqual(["saved"]);
    expect(view.live).toBe(false);
  });
  it("shows the draft graph live", () => {
    const view = combineView(
      project,
      preview(true, ["draft"]),
      null,
      true,
      false,
    );
    expect(view.resources.map((r) => r.id)).toEqual(["draft"]);
    expect(view.live).toBe(true);
  });
  it("keeps the last valid draft graph while the HCL is broken", () => {
    const last = preview(true, ["last"]);
    const view = combineView(project, preview(false, []), last, true, false);
    expect(view.resources.map((r) => r.id)).toEqual(["last"]);
    expect(view.valid).toBe(false);
    expect(view.diagnostics).toHaveLength(1);
  });
});

describe("draftOverrides", () => {
  it("ignores drafts from other projects or unknown files", () => {
    expect(
      draftOverrides(project, {
        "main.tf": {
          projectId: "p",
          content: "a",
          baseRevision: "r",
          baseContent: "",
        },
        "x.tf": {
          projectId: "p",
          content: "b",
          baseRevision: "r",
          baseContent: "",
        },
        other: {
          projectId: "q",
          content: "c",
          baseRevision: "r",
          baseContent: "",
        },
      }),
    ).toEqual({ "main.tf": "a" });
  });
});
