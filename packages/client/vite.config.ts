// Vite 配置（dev 态 Vite :5173，/api proxy → dev 分段起点：shared `PORT_RANGES.dev`）
// 注意：
// - proxy 目标是**固定值**，故 dev 段为严格单端口（不 +1）——目标与监听必须同源，
// 不得在这里复述字面量（唯一定义 = shared constants/ports.ts）
// - proxy 目标用 127.0.0.1 而非 localhost（IPv6 优先系统上 localhost 可能解析为 ::1）
// - 来源校验仅校验 host ∈ {127.0.0.1, localhost, ::1}、不校验端口，
// 因此 proxy 转发后 Host 端口为 5173 也不影响校验，无需 changeOrigin
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
import { PORT_RANGES } from "@whispering233/ai-editor-shared";

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
      "/api": `http://127.0.0.1:${PORT_RANGES.dev.base}`,
    },
  },
});
