import type { Draft, Project, Resource, Property } from "../lib/types";
import {
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

export function afterPropertySave(
  current: Record<string, PropertyDraft>,
  resource: Resource,
  property: Property,
  captured: PropertyDraft,
  before: Project,
  saved: Project,
): Record<string, PropertyDraft> {
  const next = { ...current },
    key = propertyKey(resource, property);
  if (next[key] === captured) delete next[key];
  const file = saved.files.find((f) => f.path === resource.file);
  if (!file || saved.id !== captured.projectId) return next;
  for (const [draftKey, draft] of Object.entries(next)) {
    if (
      draft.projectId !== captured.projectId ||
      draft.revision !== captured.revision
    )
      continue;
    const target = before.resources.find(
      (r) =>
        r.file === resource.file &&
        r.properties.some((p) => propertyKey(r, p) === draftKey),
    );
    const original = target?.properties.find(
      (p) => propertyKey(target, p) === draftKey,
    );
    const updated = saved.resources
      .find((r) => r.id === target?.id)
      ?.properties.find((p) => p.name === original?.name);
    if (
      original &&
      updated &&
      (draftKey === key || original.expression === updated.expression)
    )
      next[draftKey] = { ...draft, revision: file.revision };
  }
  return next;
}
