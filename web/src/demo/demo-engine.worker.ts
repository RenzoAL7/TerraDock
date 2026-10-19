import "./generated/wasm_exec.js";
import wasmUrl from "./generated/parser.wasm?url";
import type { DemoRequest, DemoResponse } from "./types";

const scope = globalThis as typeof globalThis & {
  Go: new () => {
    importObject: WebAssembly.Imports;
    run: (instance: WebAssembly.Instance) => Promise<void>;
  };
  terradockDemo: (request: string) => string;
};

const ready = (async () => {
  const go = new scope.Go();
  const response = await fetch(wasmUrl, { credentials: "omit" });
  if (!response.ok)
    throw new Error("No se pudo cargar el analizador del ejemplo.");
  const { instance } = await WebAssembly.instantiate(
    await response.arrayBuffer(),
    go.importObject,
  );
  void go.run(instance).catch(() => {
    self.postMessage({
      fatal: "El analizador se detuvo. Vuelve a intentarlo.",
    });
  });
  if (typeof scope.terradockDemo !== "function")
    throw new Error("El analizador no está disponible.");
})();

// Handle rejection immediately, even before the first request arrives.
void ready.catch(() => undefined);
self.onmessage = async (
  event: MessageEvent<{ id: number; request: DemoRequest }>,
) => {
  const { id, request } = event.data;
  try {
    await ready;
    const result: DemoResponse = JSON.parse(
      scope.terradockDemo(JSON.stringify(request)),
    );
    self.postMessage({ id, result });
  } catch {
    self.postMessage({
      id,
      result: {
        error:
          "No se pudo iniciar el analizador. Reintenta la carga del ejemplo.",
      },
    });
  }
};
