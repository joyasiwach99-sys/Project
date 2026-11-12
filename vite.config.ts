import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  server: { port: 5173, host: true },
  build: {
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
          charts: ["recharts"],
          map: ["leaflet", "react-leaflet"],
          react: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
} as any);
