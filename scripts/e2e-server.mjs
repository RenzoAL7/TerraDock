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
    await run(binary, [
      "--root",
      projectRoot,
      "--assets",
      join(repository, "web", "dist"),
      "--port",
      "7332",
    ]);
  }
} catch (error) {
  console.error(error);
  process.exitCode = 1;
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
