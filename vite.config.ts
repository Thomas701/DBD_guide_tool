import { defineConfig } from "vite";

const buildId = new Date().toISOString();

export default defineConfig({
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  esbuild: { jsx: "automatic" },
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId)
  }
});
