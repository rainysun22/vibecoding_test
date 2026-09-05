import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * 开发模式通过代理访问本地 API（单进程自托管时无需代理）。
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:4765",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: false,
  },
});
