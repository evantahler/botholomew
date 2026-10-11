import path from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Vite only exposes `VITE_`-prefixed vars to client code, and does not load
  // `.env` into `process.env` for this config file. Load the whole `.env` (empty
  // prefix) so the dev server can bind the `PORT` the environment asks for. The
  // resulting origin must appear in the backend's `WEB_SERVER_ALLOWED_ORIGINS`
  // or the browser's CORS preflight to the backend fails.
  const env = loadEnv(mode, import.meta.dirname, "");

  return {
    // Tailwind is intentionally utilities-only in `studio.css`: its Preflight
    // resets the element rules `theme.scss` and `src/ui` depend on.
    plugins: [react(), tailwindcss()],
    server: {
      port: Number(env.PORT) || 3000,
      // Fail loudly rather than silently drifting to another port, which would
      // break CORS against the backend's fixed allow-list.
      strictPort: true,
    },
    resolve: {
      // End-to-end types with no codegen: the frontend imports action response
      // types straight from the backend via `@backend/...`.
      alias: {
        "@backend": path.resolve(import.meta.dirname, "../backend"),
      },
    },
    css: {
      preprocessorOptions: {
        scss: {
          // `theme.scss` is legacy Sass: `@import`, global built-ins, the old
          // color functions, and `if()`. Compiling it emits a wall of
          // deprecation warnings that buries anything else the build has to
          // say, so silence exactly those and nothing else.
          quietDeps: true,
          silenceDeprecations: [
            "import",
            "global-builtin",
            "color-functions",
            "if-function",
          ],
        },
      },
    },
    build: {
      outDir: "dist",
    },
  };
});
