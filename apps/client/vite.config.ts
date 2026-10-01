import { defineConfig } from "vite";
import { wishlistUrl } from "../../packages/shared/src/demo.ts";

/**
 * One config, three builds: the web build (default), the DEMO web build (`VITE_DEMO=1`: the same code with the demo switch on, never a fork) and the desktop build
 * (`vite build --mode desktop`: `base: "./"` so every asset is relative and the page loads from disk through the shell's `app://` protocol with no network, into `dist-desktop`
 * so it never overwrites the web deploy). The wish-list URL is validated here (https only) and compiled in as a plain string; anything else compiles to "".
 */
export default defineConfig(({ mode }) => {
  const desktop = mode === "desktop";
  return {
    base: desktop ? "./" : "/",
    build: { target: "es2022", sourcemap: true, chunkSizeWarningLimit: 900, ...(desktop ? { outDir: "dist-desktop", emptyOutDir: true } : {}) },
    server: { host: true, port: 5173 },
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? "0.0.0"),
      __DEMO__: JSON.stringify(process.env.VITE_DEMO === "1" || process.env.VITE_DEMO === "true"),
      __WISHLIST_URL__: JSON.stringify(wishlistUrl(process.env.VITE_WISHLIST_URL) ?? ""),
      __DESKTOP__: JSON.stringify(desktop),
    },
  };
});
