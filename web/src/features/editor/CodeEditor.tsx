import { useCallback, useEffect, useRef } from "react";
import Editor from "@monaco-editor/react";
import type { Diagnostic } from "../../lib/types";
import { minimalEdit } from "./minimalEdit";
import { monaco } from "./monacoSetup";

export default function CodeEditor({
  path,
  value,
  line,
  revealKey = 0,
  diagnostics,
  onChange,
  onSave,
  onCursor,
  highlight,
  readOnly = false,
}: {
  path: string;
  value: string;
  line: number;
  /** Changes whenever `line` must be revealed again, even if unchanged. */
  revealKey?: number;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
  onSave: () => void;
  /** Called when the user (not the program) moves the caret. */
  onCursor?: (line: number) => void;
  /** Lines of the resource selected in the diagram, inclusive. */
  highlight?: { start: number; end: number } | null;
  readOnly?: boolean;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(
    null,
  );
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const lineRef = useRef(line);
  lineRef.current = line;
  const onCursorRef = useRef(onCursor);
  onCursorRef.current = onCursor;
  const start = highlight?.start ?? 0,
    end = highlight?.end ?? 0;
  const applyHighlight = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    decorations.current ??= editor.createDecorationsCollection();
    decorations.current.set(
      start > 0
        ? [
            {
              range: new monaco.Range(start, 1, Math.max(start, end), 1),
              options: {
                isWholeLine: true,
                className: "linked-resource-line",
                linesDecorationsClassName: "linked-resource-gutter",
              },
            },
          ]
        : [],
    );
  }, [start, end]);
  useEffect(applyHighlight, [applyHighlight, value]);
  const updateMarkers = useCallback(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      "terradock",
      diagnostics
        .filter((d) => d.file === path)
        .map((d) => ({
          severity:
            d.severity === "error"
              ? monaco.MarkerSeverity.Error
              : monaco.MarkerSeverity.Warning,
          message: d.message,
          startLineNumber: d.line,
          endLineNumber: d.line,
          startColumn: 1,
          endColumn: 120,
        })),
    );
  }, [diagnostics, path]);
  useEffect(updateMarkers, [updateMarkers]);
  // Apply external changes (inspector edits, saves, external files) as a
  // minimal edit, so scroll position, cursor and undo history survive.
  const valueRef = useRef(value);
  valueRef.current = value;
  const syncValue = useCallback(() => {
    const editor = editorRef.current,
      model = editor?.getModel();
    if (!editor || !model) return;
    const next = valueRef.current,
      current = model.getValue();
    if (current === next) return;
    const edit = minimalEdit(current, next);
    editor.pushUndoStop();
    editor.executeEdits("terradock", [
      {
        range: monaco.Range.fromPositions(
          model.getPositionAt(edit.start),
          model.getPositionAt(edit.end),
        ),
        text: edit.text,
        forceMoveMarkers: true,
      },
    ]);
    editor.pushUndoStop();
  }, []);
  useEffect(syncValue, [syncValue, value]);
  // After syncing the value: a line added by the same update (a resource
  // created from the diagram) must exist before it is revealed.
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && line > 0) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
  }, [line, path, revealKey]);
  return (
    <Editor
      path={path}
      language="terradock-hcl"
      theme="terradock-night"
      defaultValue={value}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="editor-loading">Abriendo editor local…</div>}
      onMount={(editor) => {
        editorRef.current = editor;
        syncValue();
        updateMarkers();
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
          onSaveRef.current(),
        );
        editor.onDidChangeCursorPosition((event) => {
          if (event.source === "api" || event.source === "modelChange") return;
          onCursorRef.current?.(event.position.lineNumber);
        });
        decorations.current = editor.createDecorationsCollection();
        applyHighlight();
        // The first layout happens after mount; scroll once it has a size.
        // Only scroll: moving the caret here could drop a user selection.
        const once = editor.onDidLayoutChange(() => {
          once.dispose();
          if (lineRef.current > 0 && !editor.hasTextFocus())
            editor.revealLineInCenter(lineRef.current);
        });
        if (line > 0) editor.revealLineInCenter(line);
      }}
      options={{
        automaticLayout: true,
        minimap: { enabled: false },
        fontFamily: "IBM Plex Mono, monospace",
        fontSize: 12,
        lineHeight: 23,
        padding: { top: 20, bottom: 20 },
        scrollBeyondLastLine: false,
        wordWrap: "on",
        tabSize: 2,
        renderLineHighlight: "line",
        smoothScrolling: true,
        ariaLabel: `Código Terraform ${path.split("/").pop()}`,
        fixedOverflowWidgets: true,
        readOnly,
      }}
    />
  );
}
