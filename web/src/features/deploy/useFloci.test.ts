import { describe, expect, it } from "vitest";
import { deployMarks } from "./useFloci";
import type { FlociStatus } from "../../lib/types";

const status = (stale = false): FlociStatus => ({
  endpoint: "http://localhost:4566",
  reachable: true,
  terraform: "/usr/bin/terraform",
  terraformVersion: "1.9.8",
  canStart: false,
  deployed: ["aws_vpc.main"],
  variables: [],
  plan: {
    projectId: "p",
    changes: { "aws_subnet.app": "create" },
    counts: { create: 1 },
    createdAt: "2026-11-12T00:00:00Z",
    stale,
  },
});

describe("deployMarks", () => {
  it("shows the plan read for the current saved revision", () => {
    expect(deployMarks(status(), "p", "r1", "r1")).toEqual({
      "aws_vpc.main": "deployed",
      "aws_subnet.app": "create",
    });
  });

  it("drops a plan read before the saved files changed", () => {
    // The status is not polled outside the Floci tab, so the client must not
    // keep showing a plan for files that no longer exist.
    expect(deployMarks(status(), "p", "r2", "r1")).toEqual({
      "aws_vpc.main": "deployed",
    });
  });

  it("drops stale plans and plans of other projects", () => {
    expect(deployMarks(status(true), "p", "r1", "r1")).toEqual({
      "aws_vpc.main": "deployed",
    });
    expect(deployMarks(status(), "other", "r1", "r1")).toEqual({
      "aws_vpc.main": "deployed",
    });
    expect(deployMarks(null, "p", "r1", "r1")).toEqual({});
  });
});
