import { defineConfig } from "vite";

export default defineConfig({
  // Rutas relativas: el build funciona en la raíz o en una subcarpeta
  // (https://usuario.github.io/eternauta-online/, itch.io, etc.).
  base: "./",
  server: {
    port: 5173,
    open: false,
  },
  build: {
    target: "es2022",
    // Spark incluye su worker y el WASM embebidos; el bundle es grande a propósito.
    chunkSizeWarningLimit: 4000,
  },
});
