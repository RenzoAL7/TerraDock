import type { DemoRequest, DemoResponse } from "./types";

export function createDemoEngine() {
  const worker = new Worker(
    new URL("./demo-engine.worker.ts", import.meta.url),
    { type: "module" },
  );
  let sequence = 0;
  let stopped = false;
  const pending = new Map<
    number,
    {
      resolve: (value: DemoResponse) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  function stop(message: string) {
    stopped = true;
    worker.terminate();
    for (const task of pending.values()) {
      clearTimeout(task.timer);
      task.reject(new Error(message));
    }
    pending.clear();
  }
  worker.onerror = () =>
    stop("No se pudo cargar el analizador. Reintenta la carga.");
  worker.onmessage = (
    event: MessageEvent<{ id: number; result: DemoResponse; fatal?: string }>,
  ) => {
    if (event.data.fatal) return stop(event.data.fatal);
    const task = pending.get(event.data.id);
    if (!task) return;
    clearTimeout(task.timer);
    pending.delete(event.data.id);
    if (event.data.result.error)
      task.reject(new Error(event.data.result.error));
    else task.resolve(event.data.result);
  };
  return {
    request(request: DemoRequest): Promise<DemoResponse> {
      if (stopped)
        return Promise.reject(new Error("Reintenta la carga para continuar."));
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            stop(
              "El análisis tardó demasiado. Reduce el ejemplo y reintenta la carga.",
            ),
          30_000,
        );
        pending.set(id, { resolve, reject, timer });
        worker.postMessage({ id, request });
      });
    },
    dispose: () => stop("Analizador cerrado."),
  };
}
