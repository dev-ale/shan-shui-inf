import { defineConfig } from "vite";

export default defineConfig({
  // relative asset paths, so the build works from any sub-path (e.g. GitHub Pages)
  base: "./",
  worker: { format: "es" },
  server: { port: 5173 },
});
