import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Independent entry: never includes the local app, its proxy, or its public assets.
export default defineConfig({
  root: fileURLToPath(new URL("./public-site", import.meta.url)),
  base: "./",
  publicDir: false,
  appType: "mpa",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5174, strictPort: true },
  preview: { host: "127.0.0.1", port: 4174, strictPort: true },
  build: {
    assetsInlineLimit: 0,
    rollupOptions: {
      input: {
        landing: fileURLToPath(
          new URL("./public-site/index.html", import.meta.url),
        ),
        demo: fileURLToPath(
          new URL("./public-site/demo/index.html", import.meta.url),
        ),
      },
    },
    outDir: fileURLToPath(new URL("./dist-public", import.meta.url)),
    emptyOutDir: true,
    sourcemap: false,
  },
  worker: {
    rollupOptions: {
      output: { entryFileNames: "assets/demo-engine-[hash].js" },
    },
  },
});
