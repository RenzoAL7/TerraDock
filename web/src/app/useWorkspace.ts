import { useCallback, useEffect, useRef, useState } from "react";
import { api, errorMessage } from "../lib/api";
import type { Project, Session } from "../lib/types";
import { mutationResult, ProjectInbox } from "./mergeProject";

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
