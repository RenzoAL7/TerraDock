import { describe, expect, it } from "vitest";
import { deployMarks, pollDelay } from "./useFloci";
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

const current = { projectId: "p", revision: "r1" };

describe("deployMarks", () => {
  it("shows the plan read for the current saved revision", () => {
    expect(deployMarks(status(), current, current)).toEqual({
      "aws_vpc.main": "deployed",
      "aws_subnet.app": "create",
    });
  });

  it("drops a plan read before the saved files changed", () => {
    // The status is not polled outside the Floci tab, so the client must not
    // keep showing a plan for files that no longer exist.
    expect(
      deployMarks(status(), current, { projectId: "p", revision: "r0" }),
    ).toEqual({ "aws_vpc.main": "deployed" });
  });

  it("marks nothing when the status was read for another project", () => {
    // Applying in project A and then opening B outside the tab must not show
    // A's resources as deployed in B.
    expect(
      deployMarks(status(), current, { projectId: "a", revision: "r1" }),
    ).toEqual({});
    expect(deployMarks(status(), current, {})).toEqual({});
  });

  it("drops stale plans and plans of other projects", () => {
    expect(deployMarks(status(true), current, current)).toEqual({
      "aws_vpc.main": "deployed",
    });
    const other = { projectId: "other", revision: "r1" };
    expect(deployMarks(status(), other, other)).toEqual({
      "aws_vpc.main": "deployed",
    });
    expect(deployMarks(null, current, current)).toEqual({});
  });

  it("marks only managed resources of the diagram", () => {
    // A state or plan address can never be a variable, local, output or
    // provider node, but the overlay must not mark one even if it collided.
    const odd = status();
    odd.deployed = ["aws_vpc.main", "var.region", "output.ip", "aws_gone.x"];
    odd.plan!.changes = {
      "aws_subnet.app": "create",
      "local.name": "update",
      "provider.aws": "delete",
    };
    const nodes = [
      { id: "aws_vpc.main", block: "resource" as const },
      { id: "aws_subnet.app", block: "resource" as const },
      { id: "var.region", block: "variable" as const },
      { id: "local.name", block: "local" as const },
      { id: "output.ip", block: "output" as const },
      { id: "provider.aws", block: "provider" as const },
    ];
    expect(deployMarks(odd, current, current, nodes)).toEqual({
      "aws_vpc.main": "deployed",
      "aws_subnet.app": "create",
    });
  });
});

describe("pollDelay", () => {
  it("polls only while the tab is visible or an operation runs", () => {
    expect(pollDelay(false, false)).toBeNull();
    expect(pollDelay(true, false)).toBe(4000);
  });

  it("keeps polling a running operation after leaving the tab", () => {
    expect(pollDelay(false, true)).toBe(700);
    expect(pollDelay(true, true)).toBe(700);
  });
});
