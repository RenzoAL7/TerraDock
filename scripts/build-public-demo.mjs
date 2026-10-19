import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  renameSync,
  rmSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const root = fileURLToPath(new URL("../", import.meta.url));
const output = path.join(root, "web/src/demo/generated");
const temporary = path.join(output, `parser-${process.pid}.wasm`);
const go = process.env.GO || "go";
mkdirSync(output, { recursive: true });
try {
  execFileSync(
    go,
    [
      "build",
      "-trimpath",
      "-ldflags=-s -w",
      "-o",
      temporary,
      "./cmd/terradock-demo",
    ],
    {
      cwd: root,
      env: { ...process.env, GOOS: "js", GOARCH: "wasm", CGO_ENABLED: "0" },
      stdio: "inherit",
    },
  );
  const goroot = execFileSync(go, ["env", "GOROOT"], {
    encoding: "utf8",
  }).trim();
  // Go requires the support script from the exact compiler toolchain.
  copyFileSync(
    path.join(goroot, "lib/wasm/wasm_exec.js"),
    path.join(output, "wasm_exec.js"),
  );
  const modules = execFileSync(
    go,
    [
      "list",
      "-deps",
      "-f",
      "{{with .Module}}{{.Path}}|{{.Dir}}{{end}}",
      "./cmd/terradock-demo",
    ],
    {
      cwd: root,
      env: { ...process.env, GOOS: "js", GOARCH: "wasm" },
      encoding: "utf8",
    },
  );
  const notices = [
    `Go runtime\n\n${readFileSync(path.join(goroot, "LICENSE"), "utf8")}`,
  ];
  for (const entry of new Set(modules.trim().split("\n").filter(Boolean))) {
    const [name, directory] = entry.split("|");
    if (directory === root.replace(/\/$/, "")) continue;
    const license = readdirSync(directory).find((filename) =>
      /^LICENSE(?:\.txt|\.md)?$/i.test(filename),
    );
    if (!license) throw new Error(`Missing license for ${name}`);
    notices.push(
      `${name}\n\n${readFileSync(path.join(directory, license), "utf8")}`,
    );
  }
  writeFileSync(
    path.join(output, "parser-licenses.txt"),
    notices.join("\n\n--------------------\n\n"),
  );
  renameSync(temporary, path.join(output, "parser.wasm"));
} finally {
  rmSync(temporary, { force: true });
}
