import { describe, expect, it } from "vitest";
import type { Project } from "../lib/types";
import { mergeProject, mutationResult, ProjectInbox } from "./mergeProject";
import { afterFileSave } from "./drafts";

function snapshot(
  sequence: number,
  instanceId = "process-a",
  id = "demo-web-app",
): Project {
  return {
    id,
    instanceId,
    sequence,
    name: id,
    mode: "demo",
    path: "",
    revision: `revision-${sequence}`,
    files: [],
    resources: [],
    edges: [],
    diagnostics: [],
    findings: [],
    valid: true,
  };
}

describe("snapshot ordering", () => {
  it("keeps a saved draft's baseline separate from a newer competing SSE edit", () => {
    const response = snapshot(7);
    response.files = [{ path: "main.tf", content: "saved B", revision: "B" }];
    const later = snapshot(8);
    later.files = [{ path: "main.tf", content: "external D", revision: "D" }];
    const visible = mergeProject(later, response, "process-a");
    const result = mutationResult(visible, response);
    expect(result).toBe(response);
    const captured = {
      projectId: response.id,
      content: "saved B",
      baseRevision: "A",
    };
    const continued = { ...captured, content: "typing C" };
    const drafts = afterFileSave(
      { "main.tf": continued },
      "main.tf",
      captured,
      result!,
    );
    expect(drafts["main.tf"].baseRevision).toBe("B");
    expect(drafts["main.tf"].baseRevision).not.toBe(visible?.files[0].revision);
    expect(
      mutationResult(snapshot(9, "process-a", "another-project"), response),
    ).toBeNull();
    expect(mutationResult(snapshot(1, "process-b"), response)).toBeNull();
  });
  it("rejects an older HTTP response after a newer SSE event", () => {
    const sse = snapshot(9);
    expect(mergeProject(sse, snapshot(7), "process-a")).toBe(sse);
    expect(mergeProject(sse, snapshot(10), "process-a")?.sequence).toBe(10);
  });

  it("orders across project switches rather than comparing per-project revisions", () => {
    const switched = snapshot(12, "process-a", "local-project");
    expect(mergeProject(switched, snapshot(11), "process-a")).toBe(switched);
  });

  it("accepts equal sequence snapshots and ignores missing or unsafe ordering metadata", () => {
    const current = snapshot(3);
    expect(mergeProject(current, snapshot(3), "process-a")).toEqual(current);
    for (const sequence of [
      NaN,
      Infinity,
      -1,
      1.5,
      Number.MAX_SAFE_INTEGER + 1,
    ]) {
      expect(mergeProject(current, snapshot(sequence), "process-a")).toBe(
        current,
      );
    }
    expect(mergeProject(current, snapshot(4, ""), "process-a")).toBe(current);
    expect(mergeProject(current, snapshot(4, "process-b"), "process-a")).toBe(
      current,
    );
  });

  it("retains early SSE events until session confirmation, then rejects a slower initial GET", () => {
    const inbox = new ProjectInbox();
    expect(inbox.receive(snapshot(8))).toBeNull();
    inbox.receive(snapshot(6));
    expect(
      inbox.confirmSession({ token: "token-a", instanceId: "process-a" })
        ?.sequence,
    ).toBe(8);
    expect(inbox.receive(snapshot(7))?.sequence).toBe(8);
  });

  it("does not reset order when the same server reconnects", () => {
    const inbox = new ProjectInbox();
    const session = { token: "token-a", instanceId: "process-a" };
    inbox.confirmSession(session);
    inbox.receive(snapshot(20));
    expect(inbox.confirmSession(session)?.sequence).toBe(20);
    expect(inbox.receive(snapshot(19))?.sequence).toBe(20);
  });

  it("accepts a restarted process only after its new session is verified", () => {
    const inbox = new ProjectInbox();
    inbox.confirmSession({ token: "token-a", instanceId: "process-a" });
    inbox.receive(snapshot(50));
    expect(inbox.receive(snapshot(2, "process-b"))?.sequence).toBe(50);
    expect(
      inbox.confirmSession({ token: "token-b", instanceId: "process-b" })
        ?.sequence,
    ).toBe(2);
    // Old HTTP completes after restart, while SSE already delivered sequence 3.
    inbox.receive(snapshot(3, "process-b"));
    expect(inbox.receive(snapshot(51))?.instanceId).toBe("process-b");
    expect(inbox.receive(snapshot(1, "process-b"))?.sequence).toBe(3);
  });

  it("allows an order reset only after the session token changes", () => {
    const inbox = new ProjectInbox();
    inbox.confirmSession({ token: "token-a", instanceId: "process-a" });
    inbox.receive(snapshot(50));
    expect(() =>
      inbox.confirmSession({ token: "token-a", instanceId: "process-b" }),
    ).toThrow();
    inbox.confirmSession({ token: "token-b", instanceId: "process-b" });
    expect(inbox.receive(snapshot(1, "process-b"))?.sequence).toBe(1);
  });
});
