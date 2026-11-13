import { useEffect, useMemo, useRef, useState } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { GitCompareArrows } from "lucide-react";
// Side-effect import: configures the bundled Monaco before the DiffEditor
// mounts. A type-only use would be elided and the loader would fall back to
// a CDN, which the local CSP blocks.
import "./monacoSetup";
import type { monaco } from "./monacoSetup";
import { rebase } from "./rebase";

let models = 0;

/** The disk version a result was computed against. */
export interface DiskBasis {
  revision: string;
  content: string;
}

/**
 * Shown instead of the code editor when the file changed on disk under a
 * draft. Left: the file on disk. Right: the draft (editable on request).
 */
export default function ConflictDiff({
  file,
  base,
  mine,
  disk,
  diskRevision,
  onKeepMine,
  onUseDisk,
  onApply,
}: {
  file: string;
  /** Text the draft started from. */
  base: string;
  mine: string;
  disk: string;
  diskRevision: string;
  /** Save this text (my changes rebased on `basis`). */
  onKeepMine: (text: string, basis: DiskBasis) => void;
  onUseDisk: () => void;
  /**
   * Keep this edited text as the draft, based on the disk version it was
   * prepared against. If the file changed again meanwhile, the comparison
   * comes back instead of silently undoing that change.
   */
  onApply: (text: string, basis: DiskBasis) => void;
}) {
  const [id] = useState(() => ++models);
  const [editing, setEditing] = useState(false);
  const [result, setResult] = useState(mine);
  const [note, setNote] = useState("");
  // Disk version shown while editing the result; it stays fixed so the
  // result is applied on the same version the user compared against.
  const [basis, setBasis] = useState<DiskBasis | null>(null);
  const current: DiskBasis = { revision: diskRevision, content: disk };
  const edit = () => {
    setBasis(current);
    setEditing(true);
  };
  const changedAgain = editing && basis && basis.revision !== diskRevision;
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null);
  // Detach and dispose the models before the diff editor itself goes away;
  // disposing them while attached makes Monaco throw.
  useEffect(
    () => () => {
      const editor = editorRef.current;
      const model = editor?.getModel();
      editor?.setModel(null);
      model?.original.dispose();
      model?.modified.dispose();
    },
    [],
  );
  const options = useMemo<monaco.editor.IDiffEditorConstructionOptions>(
    () => ({
      readOnly: !editing,
      originalEditable: false,
      renderSideBySide: true,
      useInlineViewWhenSpaceIsLimited: true,
      minimap: { enabled: false },
      fontFamily: "IBM Plex Mono, monospace",
      fontSize: 12,
      lineHeight: 23,
      scrollBeyondLastLine: false,
      wordWrap: "on",
      tabSize: 2,
      originalAriaLabel: `Versión del disco ${file}`,
      modifiedAriaLabel: editing
        ? `Resultado editable ${file}`
        : `Tu borrador ${file}`,
      fixedOverflowWidgets: true,
    }),
    [editing, file],
  );
  const keepMine = () => {
    const merged = rebase(base, mine, disk);
    if (merged.clean) {
      onKeepMine(merged.text, current);
      return;
    }
    setResult(merged.text);
    edit();
    setNote(
      merged.conflicts === 1
        ? "Tu borrador y el disco cambian las mismas líneas. Elige entre las marcas <<<<<<< y >>>>>>> y pulsa «Aplicar resultado»."
        : `Tu borrador y el disco cambian las mismas líneas en ${merged.conflicts} lugares. Elige entre las marcas <<<<<<< y >>>>>>> y pulsa «Aplicar resultado».`,
    );
  };
  return (
    <div className="conflict-diff" data-testid="conflict-diff">
      <div className="conflict-banner" role="alert">
        <GitCompareArrows size={15} />
        <span>
          <strong>{file} cambió fuera de TerraDock</strong> mientras lo
          editabas. A la izquierda está el disco; a la derecha,{" "}
          {editing ? "el resultado que vas a conservar" : "tu borrador"}.
          {note && <em> {note}</em>}
          {changedAgain && (
            <em>
              {" "}
              El archivo volvió a cambiar en el disco. Al aplicar, tu resultado
              se comparará con la versión nueva.
            </em>
          )}
        </span>
        <div className="conflict-actions">
          {editing ? (
            <>
              <button
                className="button-secondary"
                onClick={() => {
                  // Typing in the editor does not change `result`; reset both.
                  editorRef.current?.getModifiedEditor().setValue(mine);
                  setEditing(false);
                  setBasis(null);
                  setResult(mine);
                  setNote("");
                }}
              >
                Cancelar
              </button>
              <button className="button-secondary" onClick={onUseDisk}>
                Usar el del disco
              </button>
              <button
                className="button-primary"
                onClick={() =>
                  onApply(
                    editorRef.current?.getModifiedEditor().getValue() ?? result,
                    basis ?? current,
                  )
                }
              >
                Aplicar resultado
              </button>
            </>
          ) : (
            <>
              <button className="button-primary" onClick={keepMine}>
                Conservar el mío
              </button>
              <button className="button-secondary" onClick={onUseDisk}>
                Usar el del disco
              </button>
              <button className="button-secondary" onClick={edit}>
                Editar el resultado
              </button>
            </>
          )}
        </div>
      </div>
      <div className="conflict-editor">
        <DiffEditor
          original={editing && basis ? basis.content : disk}
          modified={result}
          language="terradock-hcl"
          theme="terradock-night"
          originalModelPath={`inmemory://conflict/${id}/disco/${file}`}
          modifiedModelPath={`inmemory://conflict/${id}/borrador/${file}`}
          keepCurrentOriginalModel
          keepCurrentModifiedModel
          loading={
            <div className="editor-loading">Preparando la comparación…</div>
          }
          options={options}
          onMount={(editor) => {
            editorRef.current = editor;
          }}
        />
      </div>
    </div>
  );
}
