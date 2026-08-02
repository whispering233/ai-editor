// Vite 配置（architecture.md 第 310-321 行：dev 态 Vite :5173，/api proxy → 127.0.0.1:3456）
// 注意：
// - proxy 目标用 127.0.0.1 而非 localhost（IPv6 优先系统上 localhost 可能解析为 ::1，决策 8）
// - 决策 17 修订：来源校验仅校验 host ∈ {127.0.0.1, localhost, ::1}、不校验端口，
//   因此 proxy 转发后 Host 端口为 5173 也不影响校验，无需 changeOrigin
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    proxy: {
      "/api": "http://127.0.0.1:3456",
    },
  },
});
