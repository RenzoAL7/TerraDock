import { normalizeProject, type Project, type Session } from "../lib/types";

function hasOrder(project: Project): boolean {
  return (
    typeof project.instanceId === "string" &&
    project.instanceId.length > 0 &&
    Number.isSafeInteger(project.sequence) &&
    project.sequence >= 0
  );
}

/** HTTP and SSE are independent transports. Arrival time does not order edits. */
export function mergeProject(
  current: Project | null,
  incoming: Project,
  instanceId: string,
): Project | null {
  if (!hasOrder(incoming) || incoming.instanceId !== instanceId) return current;
  if (
    current?.instanceId === incoming.instanceId &&
    incoming.sequence < current.sequence
  )
    return current;
  return normalizeProject(incoming);
}

/** Keep the write's own baseline even if a newer SSE snapshot is displayed. */
export function mutationResult(
  visible: Project | null,
  response: Project,
): Project | null {
  return visible?.id === response.id &&
    visible.instanceId === response.instanceId
    ? response
    : null;
}

/** Buffers early SSE updates until /session confirms which process owns them. */
export class ProjectInbox {
  private current: Project | null = null;
  private session: Pick<Session, "token" | "instanceId"> | null = null;
  private pending = new Map<string, Project>();

  receive(incoming: Project): Project | null {
    if (!hasOrder(incoming)) return this.current;
    if (incoming.instanceId !== this.session?.instanceId) {
      const pending = mergeProject(
        this.pending.get(incoming.instanceId) ?? null,
        incoming,
        incoming.instanceId,
      );
      if (pending) this.pending.set(incoming.instanceId, pending);
      // Only reconnects can introduce a new process; retain a bounded history.
      if (this.pending.size > 8) {
        const oldest = this.pending.keys().next().value;
        if (oldest) this.pending.delete(oldest);
      }
      return this.current;
    }
    this.current = mergeProject(
      this.current,
      incoming,
      this.session.instanceId,
    );
    return this.current;
  }

  confirmSession(info: Pick<Session, "token" | "instanceId">): Project | null {
    if (!info.token || !info.instanceId)
      throw new Error("El servidor no devolvió una sesión completa.");
    if (
      this.session?.token === info.token &&
      this.session.instanceId !== info.instanceId
    ) {
      throw new Error(
        "La identidad de la sesión cambió. Recarga la aplicación.",
      );
    }
    if (this.session?.token !== info.token) this.current = null;
    this.session = info;
    const pending = this.pending.get(info.instanceId);
    this.pending.clear();
    if (pending)
      this.current = mergeProject(this.current, pending, info.instanceId);
    return this.current;
  }
}
