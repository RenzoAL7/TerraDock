import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const temporaryDirectory = await mkdtemp(join(tmpdir(), "terradock-e2e-"));
const projectRoot = join(temporaryDirectory, "projects");
const binary = join(
  temporaryDirectory,
  process.platform === "win32" ? "terradock.exe" : "terradock",
);
// Same variable and default as web/ports.ts.
const port = Number(process.env.TERRADOCK_E2E_PORT || 7332);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("TERRADOCK_E2E_PORT debe ser un puerto entre 1 y 65535.");
  process.exit(1);
}
let activeChild;
let stopping = false;

function run(command, args) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: repository,
      stdio: "inherit",
      env: process.env,
    });
    activeChild = child;
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (stopping || code === 0) resolveRun();
      else reject(new Error(`${command} exited with ${signal ?? code}`));
    });
  });
}

// The server must answer on its port before the deadline and keep running
// until Playwright stops it. Any other exit, including a clean one, fails the
// suite instead of leaving it to talk to whatever owns the port.
function serve(args) {
  return new Promise((resolveServe, reject) => {
    const child = spawn(binary, args, {
      cwd: repository,
      stdio: "inherit",
      env: process.env,
    });
    activeChild = child;
    let ready = false;
    const deadline = Date.now() + 30_000;
    const probe = async () => {
      if (stopping || ready || child.exitCode !== null) return;
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/session`);
        if (response.ok) {
          ready = true;
          return;
        }
      } catch {
        /* not listening yet */
      }
      if (Date.now() > deadline) {
        child.kill("SIGTERM");
        reject(new Error(`terradock no respondió en 127.0.0.1:${port}`));
        return;
      }
      setTimeout(probe, 200);
    };
    void probe();
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (activeChild === child) activeChild = undefined;
      if (stopping) resolveServe();
      else
        reject(
          new Error(
            ready
              ? `terradock terminó durante las pruebas (${signal ?? code})`
              : `terradock no pudo enlazar 127.0.0.1:${port} (${signal ?? code})`,
          ),
        );
    });
  });
}

function stop() {
  stopping = true;
  activeChild?.kill("SIGTERM");
}

process.once("SIGINT", stop);
process.once("SIGTERM", stop);

try {
  await mkdir(projectRoot);
  // npm sets npm_execpath for `npm run test:e2e`; invoking its JS entrypoint
  // also avoids shell parsing and npm.cmd handling on Windows.
  if (!process.env.npm_execpath) {
    throw new Error(
      "Start the browser suite with make e2e or npm run test:e2e.",
    );
  }
  await run(process.execPath, [
    process.env.npm_execpath,
    "--prefix",
    "web",
    "run",
    "build",
  ]);
  if (!stopping) {
    await run(process.env.GO || "go", [
      "build",
      "-trimpath",
      "-o",
      binary,
      "./cmd/terradock",
    ]);
  }
  if (!stopping) {
    await serve([
      "--root",
      projectRoot,
      "--assets",
      join(repository, "web", "dist"),
      "--port",
      String(port),
    ]);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
