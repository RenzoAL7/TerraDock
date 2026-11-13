import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, flociApi } from "../../lib/api";
import type { DeployAction, FlociJob, FlociStatus } from "../../lib/types";

export type DeployMark = DeployAction | "deployed";

/** The open project and saved revision a Floci status was read for. */
export interface StatusRead {
  projectId?: string;
  revision?: string;
}

/**
 * Overlay for the diagram: planned actions when a fresh plan exists,
 * otherwise what is currently present in the Floci state.
 *
 * The status is not polled all the time, so it may have been read for
 * another project or an older saved revision. Nothing is marked for another
 * project, and a plan read before the files changed is dropped instead of
 * waiting for the server to mark it stale.
 */
export function deployMarks(
  status: FlociStatus | null,
  current: StatusRead,
  read: StatusRead,
): Record<string, DeployMark> {
  const marks: Record<string, DeployMark> = {};
  if (!status || !current.projectId || read.projectId !== current.projectId)
    return marks;
  for (const id of status.deployed) marks[id] = "deployed";
  if (
    status.plan &&
    !status.plan.stale &&
    status.plan.projectId === current.projectId &&
    read.revision === current.revision
  )
    Object.assign(marks, status.plan.changes);
  return marks;
}

/**
 * Milliseconds until the next status request, or null to stop polling.
 * Polls while the Floci tab is visible or an operation is running, so plan,
 * apply and destroy keep updating the diagram after leaving the tab.
 */
export function pollDelay(visible: boolean, running: boolean): number | null {
  if (running) return 700;
  return visible ? 4000 : null;
}

/**
 * Floci status for the open project. Nothing is requested while the tab is
 * hidden and no operation runs: opening a folder, editing or viewing the
 * diagram never contacts the Floci endpoints or asks the server to run
 * Terraform.
 */
export function useFloci(
  projectId: string | undefined,
  revision: string | undefined,
  visible: boolean,
) {
  const [status, setStatus] = useState<FlociStatus | null>(null);
  const [read, setRead] = useState<StatusRead>({});
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const running = status?.job?.state === "running";
  const timer = useRef<number | undefined>(undefined);
  const currentRef = useRef<StatusRead>({ projectId, revision });
  currentRef.current = { projectId, revision };

  const refresh = useCallback(async () => {
    const requested = currentRef.current;
    try {
      setStatus(await flociApi.status());
      setRead(requested);
      setAvailable(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 503)
        setAvailable(false);
    }
  }, []);

  useEffect(() => {
    const delay = pollDelay(visible, running);
    if (delay === null) return;
    let active = true;
    const tick = async () => {
      await refresh();
      if (active) timer.current = window.setTimeout(tick, delay);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, [refresh, running, projectId, visible]);

  const run = useCallback(
    async (
      action: FlociJob["action"],
      variables: Record<string, string> = {},
    ) => {
      if (!projectId) return;
      setError("");
      try {
        await flociApi.run(action, projectId, variables);
      } catch (reason) {
        setError(
          reason instanceof Error ? reason.message : "No se pudo iniciar.",
        );
      }
      await refresh();
    },
    [projectId, refresh],
  );

  const cancel = useCallback(async () => {
    try {
      await flociApi.cancel();
    } finally {
      await refresh();
    }
  }, [refresh]);

  return {
    status,
    read,
    available,
    error,
    setError,
    run,
    cancel,
    running,
  };
}
