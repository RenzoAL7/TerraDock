import type { Draft, Project, Resource, SourceFile } from "../lib/types";
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
    next[path] = {
      ...latest,
      baseRevision: file.revision,
      baseContent: file.content,
    };
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
  const previous = current[path];
  next[path] = previous
    ? { ...previous, content }
    : {
        content,
        baseRevision: saved.revision,
        baseContent: saved.content,
        projectId,
      };
  return next;
}

/** What a file shows right now: its draft in this project, or its disk text. */
export interface LiveFile {
  projectId: string;
  file: SourceFile;
  content: string;
  /** Disk revision the content is based on. */
  baseRevision: string;
}

/**
 * Read the live text of a file. Edits that await the server call it again
 * after the response: a save or a reload may have landed meanwhile, and the
 * result must be compared with (and stored against) the file as it is now.
 */
export function liveFile(
  project: Project | null | undefined,
  drafts: Record<string, Draft>,
  path: string,
): LiveFile | null {
  const file = project?.files.find((f) => f.path === path);
  if (!project || !file) return null;
  const draft =
    drafts[path]?.projectId === project.id ? drafts[path] : undefined;
  return {
    projectId: project.id,
    file,
    content: draft ? draft.content : file.content,
    baseRevision: draft ? draft.baseRevision : file.revision,
  };
}

/** Same project and same text: a result computed on `before` applies to `now`. */
export function sameText(
  before: LiveFile,
  now: LiveFile | null,
): now is LiveFile {
  return (
    !!now &&
    now.projectId === before.projectId &&
    now.content === before.content
  );
}
