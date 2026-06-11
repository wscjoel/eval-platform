import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// 构建产物直接落到 backend/app/static，FastAPI 单服务托管前后端。
const STATIC_OUT = path.resolve(__dirname, "../backend/app/static");

export default defineConfig({
  plugins: [react()],
  // 相对路径资源引用：同时兼容 GitHub Pages 子路径与 FastAPI 静态托管
  base: "./",
  build: {
    outDir: STATIC_OUT,
    emptyOutDir: true,
    sourcemap: false,
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:8000",
    },
  },
});