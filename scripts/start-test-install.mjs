/**
 * 在测试安装目录启动 ai-editor（根命令 `pnpm start:test`）。
 *
 * 前置：先运行 `pnpm pack:test`（安装目录不存在或未装 bin → 提示并退出 1）。
 * 行为：前台 spawn 安装目录的 bin（node_modules/.bin/ai-editor），stdio inherit——
 *   阻塞前台运行，Ctrl-C 退出（SIGINT 由 server 的 shutdown 处理优雅退出）。
 *   创作根 = 安装目录本身（无 project.json → 书架模式待命，浏览器自动打开界面，
 *   生产态默认 openBrowser=true，URL 为 127.0.0.1:{port}，决策 8）。
 * 端口：AI_EDITOR_PORT 环境变量可覆盖默认 3456（与 dev server 并存时指定独立端口）。
 */
import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";

/** 安装目录（与 pack-test-install.mjs 同一默认值/覆盖变量） */
const installDir = process.env.AI_EDITOR_TEST_DIR ?? "/tmp/opencode/ai-editor-install-test";

const binPath = join(installDir, "node_modules", ".bin", "ai-editor");
if (!existsSync(binPath)) {
  console.error(`[start:test] 未找到 ${binPath}`);
  console.error("[start:test] 请先运行 pnpm pack:test（打包 → 安装到测试目录）");
  process.exit(1);
}

console.log(`[start:test] 启动测试服务（创作根: ${installDir}）`);
console.log(`[start:test] 端口: ${process.env.AI_EDITOR_PORT ?? "3456（默认，可 AI_EDITOR_PORT 覆盖）"}，Ctrl-C 退出`);

// 前台 spawn：stdio inherit 直通输出，信号默认传递（Ctrl-C → server 的 SIGINT handler 优雅退出）
const child = spawn(binPath, [installDir], { stdio: "inherit", env: process.env });

child.on("error", (err) => {
  console.error(`[start:test] 启动失败: ${err.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});
