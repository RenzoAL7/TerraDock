import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Draft, Project, Session } from "../lib/types";
import { mutationResult, ProjectInbox } from "./mergeProject";
import { draftKey, newTabId, projectLocation, TAB_ID } from "./draftStore";

const startupConnectionError =
  "No se pudo conectar con el servidor local. Comprueba que TerraDock está ejecutándose y vuelve a intentar.";

export function useWorkspace() {
  const [project, setProject] = useState<Project | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const inbox = useRef(new ProjectInbox());
  const sessionRef = useRef<Session | null>(null);
  const connectedRef = useRef(false);
  const busyRef = useRef(false);
  const activeRef = useRef(false);

  useEffect(() => {
    let active = true;
    let generation = 0;
    let refresh = Promise.resolve();
    activeRef.current = true;
    const events = new EventSource("/api/events");
    const receive = (next: Project) => {
      const accepted = inbox.current.receive(next);
      if (active && accepted) setProject(accepted);
    };
    events.addEventListener("project", (event: MessageEvent) => {
      if (!active) return;
      try {
        receive(JSON.parse(event.data) as Project);
      } catch {
        setError("Llegó una actualización incompleta. Recarga el proyecto.");
      }
    });

    events.onopen = () => {
      const connection = ++generation;
      connectedRef.current = false;
      setConnected(false);
      // Serialize refreshes: api.session also updates the mutation token.
      // A delayed response from a previous connection must not win that race.
      refresh = refresh.then(async () => {
        if (!active || connection !== generation) return;
        try {
          const info = await api.session();
          if (!active || connection !== generation) return;
          const buffered = inbox.current.confirmSession(info);
          sessionRef.current = info;
          setSession(info);
          if (buffered) setProject(buffered);
          // SSE may update the project during this GET. Merge by sequence so a
          // slower HTTP response cannot overwrite the newer event.
          const initial = await api.project();
          if (!active || connection !== generation) return;
          if (initial.instanceId !== info.instanceId) {
            throw new Error(
              "El servidor reinició durante la conexión. Espera a la reconexión local.",
            );
          }
          receive(initial);
          connectedRef.current = true;
          setConnected(true);
          setError((current) =>
            current === startupConnectionError ? "" : current,
          );
        } catch (reason) {
          if (active && connection === generation) {
            connectedRef.current = false;
            setConnected(false);
            setError(errorMessage(reason));
          }
        }
      });
    };
    events.onerror = () => {
      ++generation;
      connectedRef.current = false;
      if (active) {
        setConnected(false);
        if (!sessionRef.current) setError(startupConnectionError);
      }
    };
    return () => {
      active = false;
      activeRef.current = false;
      connectedRef.current = false;
      ++generation;
      events.close();
    };
  }, []);

  const perform = useCallback(async (work: () => Promise<Project>) => {
    // State updates render later; this ref closes the double-click window now.
    if (busyRef.current) return null;
    if (!connectedRef.current) {
      setError(
        "Espera a que se restablezca la conexión local antes de guardar.",
      );
      return null;
    }
    busyRef.current = true;
    setBusy(true);
    setError("");
    const token = sessionRef.current?.token;
    try {
      const next = await work();
      if (!activeRef.current || token !== sessionRef.current?.token)
        return null;
      const accepted = inbox.current.receive(next);
      if (accepted) setProject(accepted);
      // Rebase drafts against this exact write's revision, never against a
      // newer SSE update from another editor. The UI still keeps that newer
      // snapshot so any competing edit produces a visible revision conflict.
      return mutationResult(accepted, next);
    } catch (reason) {
      if (activeRef.current) setError(errorMessage(reason));
      return null;
    } finally {
      busyRef.current = false;
      if (activeRef.current) setBusy(false);
    }
  }, []);
  return { project, session, error, setError, connected, busy, perform };
}

type PresenceMessage =
  | { kind: "hello"; tab: string }
  | { kind: "drafts"; tab: string; keys: string[] }
  | { kind: "bye"; tab: string };

export type PresenceChannel = Pick<
  BroadcastChannel,
  "postMessage" | "close" | "onmessage"
>;

function presenceMessage(data: unknown): PresenceMessage | null {
  if (typeof data !== "object" || data === null) return null;
  const message = data as Partial<PresenceMessage> & { keys?: unknown };
  if (typeof message.tab !== "string") return null;
  if (message.kind === "hello" || message.kind === "bye")
    return message as PresenceMessage;
  if (
    message.kind === "drafts" &&
    Array.isArray(message.keys) &&
    message.keys.every((k) => typeof k === "string")
  )
    return message as PresenceMessage;
  return null;
}

/**
 * Tells the other tabs of this browser which files have unsaved drafts here,
 * and keeps the set of draft keys they announce. Without BroadcastChannel it
 * does nothing. Only keys travel between tabs, never file contents.
 */
export class DraftPresence {
  private mine: string[] = [];
  private others = new Map<string, string[]>();

  constructor(
    private channel: PresenceChannel | null,
    private onChange: (keys: ReadonlySet<string>) => void,
    /** Same id the draft store writes under, so both name this tab alike. */
    readonly tab: string = newTabId(),
  ) {
    this.listen(channel);
  }

  /**
   * Listen again after the page comes back from the back/forward cache: the
   * channel was closed on `pagehide`. Re-announces this tab's drafts and asks
   * the others for theirs, since messages sent meanwhile were lost.
   */
  reopen(channel: PresenceChannel | null) {
    this.channel?.close();
    this.channel = channel;
    this.others.clear();
    this.onChange(new Set());
    this.listen(channel);
    if (this.mine.length)
      this.post({ kind: "drafts", tab: this.tab, keys: this.mine });
  }

  private listen(channel: PresenceChannel | null) {
    if (!channel) return;
    channel.onmessage = (event: MessageEvent) => this.receive(event.data);
    this.post({ kind: "hello", tab: this.tab });
  }

  publish(keys: string[]) {
    const sorted = [...keys].sort();
    if (sorted.join("\n") === this.mine.join("\n")) return;
    this.mine = sorted;
    this.post({ kind: "drafts", tab: this.tab, keys: sorted });
  }

  close() {
    this.post({ kind: "bye", tab: this.tab });
    this.channel?.close();
    this.channel = null;
  }

  private post(message: PresenceMessage) {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closed channel only loses the notice, never edits.
    }
  }

  private receive(data: unknown) {
    const message = presenceMessage(data);
    if (!message || message.tab === this.tab) return;
    if (message.kind === "hello") {
      // A new tab asks who is editing what.
      if (this.mine.length)
        this.post({ kind: "drafts", tab: this.tab, keys: this.mine });
      return;
    }
    if (message.kind === "drafts" && message.keys.length)
      this.others.set(message.tab, message.keys);
    else this.others.delete(message.tab);
    this.onChange(new Set([...this.others.values()].flat()));
  }
}

/**
 * Files of the open project that another tab of this browser is editing
 * without saving. Announced over BroadcastChannel; nothing leaves the browser.
 */
export function useOtherTabDrafts(
  session: Session | null,
  project: Project | null,
  drafts: Record<string, Draft>,
): ReadonlySet<string> {
  const [others, setOthers] = useState<ReadonlySet<string>>(new Set());
  const presence = useRef<DraftPresence | null>(null);
  useEffect(() => {
    const open = () =>
      typeof BroadcastChannel === "undefined"
        ? null
        : new BroadcastChannel("terradock-drafts");
    const current = new DraftPresence(open(), setOthers, TAB_ID);
    presence.current = current;
    const leave = () => current.close();
    // A page restored from the back/forward cache keeps its drafts: announce
    // them again on a fresh channel.
    const back = (event: PageTransitionEvent) => {
      if (event.persisted) current.reopen(open());
    };
    window.addEventListener("pagehide", leave);
    window.addEventListener("pageshow", back);
    return () => {
      window.removeEventListener("pagehide", leave);
      window.removeEventListener("pageshow", back);
      current.close();
      presence.current = null;
    };
  }, []);
  const root = session?.root;
  const location = project ? projectLocation(project) : undefined;
  const projectId = project?.id;
  useEffect(() => {
    if (!root || location === undefined) return;
    presence.current?.publish(
      Object.entries(drafts)
        .filter(([, draft]) => draft.projectId === projectId)
        .map(([file]) => draftKey(root, location, file)),
    );
  }, [root, location, projectId, drafts]);
  return useMemo(() => {
    if (!root || location === undefined) return new Set<string>();
    const files = new Set<string>();
    for (const file of project?.files ?? [])
      if (others.has(draftKey(root, location, file.path))) files.add(file.path);
    return files;
  }, [others, root, location, project?.files]);
}
