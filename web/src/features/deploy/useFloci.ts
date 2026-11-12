import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, flociApi } from "../../lib/api";
import type { DeployAction, FlociJob, FlociStatus } from "../../lib/types";

export type DeployMark = DeployAction | "deployed";

/**
 * Overlay for the diagram: planned actions when a fresh plan exists,
 * otherwise what is currently present in the Floci state.
 */
export function deployMarks(
  status: FlociStatus | null,
  projectId: string,
): Record<string, DeployMark> {
  const marks: Record<string, DeployMark> = {};
  if (!status) return marks;
  for (const id of status.deployed) marks[id] = "deployed";
  if (status.plan && !status.plan.stale && status.plan.projectId === projectId)
    Object.assign(marks, status.plan.changes);
  return marks;
}

export function useFloci(projectId: string | undefined) {
  const [status, setStatus] = useState<FlociStatus | null>(null);
  const [available, setAvailable] = useState(true);
  const [error, setError] = useState("");
  const running = status?.job?.state === "running";
  const timer = useRef<number | undefined>(undefined);

  const refresh = useCallback(async () => {
    try {
      setStatus(await flociApi.status());
      setAvailable(true);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 503)
        setAvailable(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      await refresh();
      if (active) timer.current = window.setTimeout(tick, running ? 700 : 4000);
    };
    void tick();
    return () => {
      active = false;
      clearTimeout(timer.current);
    };
  }, [refresh, running, projectId]);

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

  return { status, available, error, setError, run, cancel, running };
}
