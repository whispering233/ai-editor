/**
 * 复制 client/dist 到 packages/server/client-dist（打包安装场景的 SPA 携带）。
 *
 * 用途：server 的 tarball（files: ["dist", "client-dist"]）需要包含 SPA 构建产物，
 * 安装到测试目录后 ai-editor 命令才能打开完整界面（浏览器 SPA，对齐 inkos 体验）；
 * monorepo 开发态仍走 ../../client/dist（见 index.ts defaultClientDist 双路径）。
 *
 * 调用时机：server 包的 prepack（"prepack": "node ../../scripts/copy-client-dist.mjs && ..."），
 * pack 时自动确保 SPA 就位；也可手动执行（根 pnpm -r build 后）。
 *
 * 前提：packages/client/dist 必须已构建（根 pnpm -r build 保证）；
 * 源不存在/复制失败 → 打印警告并 exit 0（保持 server 无 SPA 的优雅降级能力，
 * SPA fallback 返回 404 JSON 提示而非崩溃）。
 */
import { cpSync, existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const src = join(workspaceRoot, "packages", "client", "dist");
const dest = join(workspaceRoot, "packages", "server", "client-dist");

if (!existsSync(src)) {
  process.stderr.write(`[copy-client-dist] 警告: ${src} 不存在（client 未构建？）——tarball 将不含 SPA，安装后界面优雅降级\n`);
  process.exit(0);
}

try {
  // 先清空目标再复制（构建产物，原子性不强求）
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dirname(dest), { recursive: true });
  cpSync(src, dest, { recursive: true });
  process.stderr.write(`[copy-client-dist] ${src} → ${dest} 完成\n`);
} catch (err) {
  process.stderr.write(`[copy-client-dist] 警告: 复制失败（${String(err)}）——tarball 将不含 SPA\n`);
  process.exit(0);
}
