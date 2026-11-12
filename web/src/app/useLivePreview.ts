import { useEffect, useMemo, useRef, useState } from "react";
import { liveApi } from "../lib/api";
import type {
  Diagnostic,
  Draft,
  Finding,
  Preview,
  Project,
  Resource,
  ResourceEdge,
} from "../lib/types";

/** What the diagram, inspector and analysis show: saved files plus drafts. */
export interface LiveView {
  resources: Resource[];
  edges: ResourceEdge[];
  diagnostics: Diagnostic[];
  findings: Finding[];
  valid: boolean;
  /** True when unsaved drafts are reflected in the view. */
  live: boolean;
  /** True while the latest keystrokes are still being analyzed. */
  pending: boolean;
}

/** Drafts that belong to the open project, keyed by file path. */
export function draftOverrides(
  project: Project,
  drafts: Record<string, Draft>,
): Record<string, string> {
  const files: Record<string, string> = {};
  for (const [path, draft] of Object.entries(drafts)) {
    if (
      draft.projectId === project.id &&
      project.files.some((f) => f.path === path)
    )
      files[path] = draft.content;
  }
  return files;
}

/**
 * Layer a preview over the saved project. Invalid drafts keep the last valid
 * graph (like the server does for saved files) but surface live diagnostics.
 */
export function combineView(
  project: Project,
  preview: Preview | null,
  lastValid: Pick<Preview, "resources" | "edges"> | null,
  hasDrafts: boolean,
  pending: boolean,
): LiveView {
  if (!hasDrafts || !preview || preview.projectId !== project.id)
    return {
      resources: project.resources,
      edges: project.edges,
      diagnostics: project.diagnostics,
      findings: project.findings,
      valid: project.valid,
      live: false,
      pending: hasDrafts && pending,
    };
  const graph = preview.valid ? preview : (lastValid ?? project);
  return {
    resources: graph.resources,
    edges: graph.edges,
    diagnostics: preview.diagnostics,
    findings: preview.valid ? preview.findings : project.findings,
    valid: preview.valid,
    live: true,
    pending,
  };
}

const normalize = (p: Preview): Preview => ({
  ...p,
  resources: (p.resources ?? []).map((r) => ({
    ...r,
    properties: r.properties ?? [],
    dependsOn: r.dependsOn ?? [],
  })),
  edges: p.edges ?? [],
  diagnostics: p.diagnostics ?? [],
  findings: p.findings ?? [],
});

/** Re-analyze drafts on every keystroke (debounced) without touching disk. */
export function useLivePreview(
  project: Project | null,
  drafts: Record<string, Draft>,
  delay = 60,
): LiveView | null {
  const overrides = useMemo(
    () => (project ? draftOverrides(project, drafts) : {}),
    [project, drafts],
  );
  const hasDrafts = Object.keys(overrides).length > 0;
  const [preview, setPreview] = useState<Preview | null>(null);
  const [pending, setPending] = useState(false);
  const lastValid = useRef<Preview | null>(null);
  const request = useRef(0);
  const projectId = project?.id;
  const revision = project?.revision;

  useEffect(() => {
    if (lastValid.current?.projectId !== projectId) lastValid.current = null;
  }, [projectId]);

  useEffect(() => {
    const id = ++request.current;
    if (!projectId || !hasDrafts) {
      setPending(false);
      setPreview(null);
      return;
    }
    setPending(true);
    const timer = window.setTimeout(() => {
      liveApi
        .analyze(projectId, overrides)
        .then((result) => {
          if (id !== request.current) return;
          const next = normalize(result);
          if (next.valid) lastValid.current = next;
          setPreview(next);
          setPending(false);
        })
        .catch(() => {
          if (id === request.current) setPending(false);
        });
    }, delay);
    return () => clearTimeout(timer);
    // `revision` re-runs the preview when saved files change underneath drafts.
  }, [projectId, revision, overrides, hasDrafts, delay]);

  return useMemo(
    () =>
      project
        ? combineView(project, preview, lastValid.current, hasDrafts, pending)
        : null,
    [project, preview, hasDrafts, pending],
  );
}
