import type { Draft, Project, Resource } from "../lib/types";
import {
  propertyInputValue,
  propertyKey,
  type PropertyDraft,
} from "../features/inspector/Inspector";

// A successful save advances the baseline of typing that happened during that
// request, but never advances a draft from a different project or revision.
export function afterFileSave(
  current: Record<string, Draft>,
  path: string,
  captured: Draft,
  saved: Project,
): Record<string, Draft> {
  const latest = current[path];
  if (!latest) return current;
  const next = { ...current };
  if (latest === captured) {
    delete next[path];
    return next;
  }
  const file = saved.files.find((f) => f.path === path);
  if (
    file &&
    saved.id === captured.projectId &&
    latest.projectId === captured.projectId &&
    latest.baseRevision === captured.baseRevision
  )
    next[path] = { ...latest, baseRevision: file.revision };
  return next;
}

/**
 * Inspector text is only kept while it differs from what the live view shows.
 * Once the code draft reflects it (or the field disappears), it is dropped.
 */
export function settledProperties(
  current: Record<string, PropertyDraft>,
  resources: Resource[],
  projectId: string,
): Record<string, PropertyDraft> {
  let changed = false;
  const next: Record<string, PropertyDraft> = {};
  for (const [key, draft] of Object.entries(current)) {
    const match = resources
      .flatMap((r) => r.properties.map((p) => [r, p] as const))
      .find(([r, p]) => p.editable && propertyKey(r, p) === key);
    if (
      draft.projectId !== projectId ||
      !match ||
      propertyInputValue(match[1]) === draft.text
    ) {
      changed = true;
      continue;
    }
    next[key] = draft;
  }
  return changed ? next : current;
}

/** Store new editor/inspector content as a draft, or drop it if it matches disk. */
export function withDraft(
  current: Record<string, Draft>,
  path: string,
  content: string,
  saved: { content: string; revision: string },
  projectId: string,
): Record<string, Draft> {
  const next = { ...current };
  if (content === saved.content) {
    delete next[path];
    return next;
  }
  next[path] = {
    content,
    baseRevision: current[path]?.baseRevision ?? saved.revision,
    projectId: current[path]?.projectId ?? projectId,
  };
  return next;
}
