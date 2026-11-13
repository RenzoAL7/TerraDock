// Local Monaco setup shared by the code editor and the conflict diff: the
// bundled copy (no CDN), its worker, the HCL tokenizer and the theme.
import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor/editor/editor.api.js";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

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

export { monaco };
