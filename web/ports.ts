// Loopback ports of the browser suites. Override them to run two suites on
// the same machine at once (two worktrees, two agents).

function port(variable: string, fallback: number) {
  const raw = process.env[variable];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1 || value > 65535)
    throw new Error(`${variable} debe ser un puerto entre 1 y 65535.`);
  return value;
}

/** Go server of `make e2e`; scripts/e2e-server.mjs reads the same variable. */
export const e2ePort = port("TERRADOCK_E2E_PORT", 7332);
/** Built public site of `make public-e2e` (vite preview). */
export const publicPreviewPort = port("TERRADOCK_PUBLIC_PREVIEW_PORT", 4174);
/** Development entry of the public site (vite dev). */
export const publicDevPort = port("TERRADOCK_PUBLIC_DEV_PORT", 5174);
