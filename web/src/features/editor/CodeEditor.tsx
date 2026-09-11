import { useCallback, useEffect, useRef } from "react";
import Editor, { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";
import type { Diagnostic } from "../../lib/types";

self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });
monaco.languages.register({ id: "terradock-hcl" });
monaco.languages.setMonarchTokensProvider("terradock-hcl", {
  tokenizer: {
    root: [
      [/#.*$/, "comment"],
      [/\/\/.*$/, "comment"],
      [/\/\*/, "comment", "@comment"],
      [/"([^"\\]|\\.)*"/, "string"],
      [
        /\b(resource|data|variable|output|locals|module|terraform|provider)\b/,
        "keyword",
      ],
      [/\b(true|false|null)\b/, "constant"],
      [/\b\d+(\.\d+)?\b/, "number"],
      [/\b(var|local|each|count)\b/, "type"],
      [/[{}[\]()]/, "delimiter.bracket"],
      [/=/, "operator"],
    ],
    comment: [
      [/[^/*]+/, "comment"],
      [/\*\//, "comment", "@pop"],
      [/[/*]/, "comment"],
    ],
  },
});
monaco.editor.defineTheme("terradock-night", {
  base: "vs-dark",
  inherit: true,
  rules: [
    { token: "keyword", foreground: "BEA0E9" },
    { token: "string", foreground: "A6D1AA" },
    { token: "comment", foreground: "738498" },
    { token: "number", foreground: "E6BA82" },
    { token: "constant", foreground: "82C5E4" },
    { token: "type", foreground: "80B9E0" },
  ],
  colors: {
    "editor.background": "#152235",
    "editor.foreground": "#D6E0EB",
    "editorLineNumber.foreground": "#607389",
    "editor.selectionBackground": "#314C6A",
    "editor.lineHighlightBackground": "#1A2B40",
    "editorCursor.foreground": "#9CC6E7",
  },
});

export default function CodeEditor({
  path,
  value,
  line,
  diagnostics,
  onChange,
  onSave,
}: {
  path: string;
  value: string;
  line: number;
  diagnostics: Diagnostic[];
  onChange: (value: string) => void;
  onSave: () => void;
}) {
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  useEffect(() => {
    const editor = editorRef.current;
    if (editor && line > 0) {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: 1 });
    }
  }, [line, path]);
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
  return (
    <Editor
      path={path}
      language="terradock-hcl"
      theme="terradock-night"
      value={value}
      onChange={(v) => onChange(v ?? "")}
      loading={<div className="editor-loading">Abriendo editor local…</div>}
      onMount={(editor) => {
        editorRef.current = editor;
        updateMarkers();
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () =>
          onSaveRef.current(),
        );
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
      }}
    />
  );
}
