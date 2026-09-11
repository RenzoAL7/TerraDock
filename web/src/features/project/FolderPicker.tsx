import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Folder,
  FolderOpen,
  Loader2,
} from "lucide-react";
import { Dialog } from "../../components/Dialog";
import { api, errorMessage } from "../../lib/api";
import type { Directory } from "../../lib/types";

export function FolderPicker({
  root,
  busy,
  error,
  onClose,
  onOpen,
}: {
  root: string;
  busy: boolean;
  error: string;
  onClose: () => void;
  onOpen: (path: string) => Promise<void>;
}) {
  const [listing, setListing] = useState<Directory | null>(null);
  const [path, setPath] = useState(root),
    [loading, setLoading] = useState(false),
    [localError, setLocalError] = useState("");
  const requestId = useRef(0);
  const navigate = useCallback(async (target: string) => {
    const id = ++requestId.current;
    setLoading(true);
    setLocalError("");
    try {
      const result = await api.directories(target);
      if (id === requestId.current) {
        setListing(result);
        setPath(result.path);
      }
    } catch (reason) {
      if (id === requestId.current) setLocalError(errorMessage(reason));
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void navigate(root);
    return () => {
      // Invalidate in-flight directory requests, including Strict Mode cleanup.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      requestId.current++;
    };
  }, [root, navigate]);
  return (
    <Dialog title="Abrir carpeta local" onClose={onClose} wide>
      <p className="dialog-intro">
        Selecciona la carpeta que contiene tus archivos <code>.tf</code>. Los
        cambios se guardarán en sus archivos originales.
      </p>
      <form
        className="folder-path"
        onSubmit={(e) => {
          e.preventDefault();
          void navigate(path);
        }}
      >
        <button
          type="button"
          className="icon-button"
          aria-label="Carpeta superior"
          disabled={!listing?.parent || loading}
          onClick={() => void navigate(listing!.parent)}
        >
          <ArrowLeft size={17} />
        </button>
        <input
          aria-label="Ruta de carpeta"
          value={path}
          onChange={(e) => setPath(e.target.value)}
        />
        <button
          className="icon-button"
          aria-label="Ir a la ruta"
          disabled={loading}
        >
          <ArrowRight size={17} />
        </button>
      </form>
      {(localError || error) && (
        <p role="alert" className="inline-error">
          {localError || error}
        </p>
      )}
      <div className="directory-list" aria-busy={loading}>
        {loading && (
          <div className="folder-loading">
            <Loader2 className="spin" size={20} /> Leyendo carpetas…
          </div>
        )}
        {!loading &&
          listing?.entries.map((entry) => (
            <button key={entry.path} onClick={() => void navigate(entry.path)}>
              <Folder size={20} />
              <span>{entry.name}</span>
              {entry.hasTerraform && <small>Terraform</small>}
              <ArrowRight size={16} />
            </button>
          ))}
        {!loading && listing && !listing.entries.length && (
          <p className="empty-directory">
            Sin subcarpetas. Puedes abrir esta ubicación.
          </p>
        )}
      </div>
      <p className="root-note">
        Ubicación permitida: <code>{root}</code>
      </p>
      <div className="dialog-footer">
        <button className="button-secondary" disabled={busy} onClick={onClose}>
          Cancelar
        </button>
        <button
          className="button-primary"
          disabled={
            busy || loading || !listing || path !== listing.path || !!localError
          }
          onClick={() => void onOpen(listing!.path)}
        >
          <FolderOpen size={16} /> Abrir esta carpeta
        </button>
      </div>
    </Dialog>
  );
}
