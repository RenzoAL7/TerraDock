import { Component, type ReactNode } from "react";

export class ErrorBoundary extends Component<
  { children: ReactNode },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    if (this.state.failed)
      return (
        <main className="startup">
          <h1>No pudimos mostrar el espacio de trabajo</h1>
          <p>
            Los archivos guardados permanecen en tu proyecto. Recarga para
            volver a abrirlo.
          </p>
          <button onClick={() => window.location.reload()}>
            Recargar TerraDock
          </button>
        </main>
      );
    return this.props.children;
  }
}
