import { defineConfig } from "vite";

const buildId = new Date().toISOString();

export default defineConfig({
  server: {
    host: "127.0.0.1", port: 5173, strictPort: true,
    // Chrome verrouille ses fichiers de profil sous Windows.
    watch: { ignored: ["**/.data/**", "**/.tmp-*"] }
  },
  esbuild: { jsx: "automatic" },
  define: {
    __APP_BUILD_ID__: JSON.stringify(buildId)
  }
});
