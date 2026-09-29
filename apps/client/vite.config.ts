import { defineConfig } from "vite";

export default defineConfig({
  build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 900 },
  server: { host: true, port: 5173 },
  define: { __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0") },
});
