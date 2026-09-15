#!/usr/bin/env node
// 桌面版打包：pnpm deploy（自包含扁平依赖）→ electron-builder（asar + 安装包）。
//
// 为什么不让 electron-builder 自己收依赖：pnpm 的符号链接树会让它漏收 `@whispering233/*`
// workspace 包（`docs/design/50-desktop.md` §5）。deploy 负责依赖，builder 只管安装包。
import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const packageName = "@whispering233/ai-editor-desktop";
const deployDir = join(pkgDir, ".deploy");
const deployApp = join(deployDir, "app");

/** 同步执行并继承 stdio（打包过程需可见；失败即抛，由调用方脚本链中断） */
function run(cmd, args, cwd = pkgDir) {
  execFileSync(cmd, args, { cwd, stdio: "inherit" });
}

/**
 * pnpm 命令行名称：Windows 上是 `pnpm.cmd`——`execFileSync` 不经 shell 时**不会**解析 `.cmd`
 * 扩展名，直接传 `pnpm` 会 `spawnSync pnpm ENOENT`（v0.0.40 的 Windows 打包 job 实测踩到）。
 */
const PNPM = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

rmSync(deployDir, { recursive: true, force: true });

try {
  // pnpm 12.2+ 的 deploy 默认实现不再要求 injected workspace（链接的 workspace 依赖会改写成 file:）
  run(PNPM, ["--filter", packageName, "deploy", "--prod", deployApp]);

  // 目标平台参数透传（如 `--linux AppImage` / `--mac dmg` / `--win nsis`），缺省用配置里的默认
  run(PNPM, ["exec", "electron-builder", "--config", "electron-builder.yml", ...process.argv.slice(2)]);
} finally {
  // 必须清：`.deploy/app` 里有 workspace 外的 package.json + node_modules，会让 pnpm 的依赖状态
  // 检查误判（后续任何 pnpm 脚本都报「需重建 modules 目录」）；产物已在 release/，无保留价值。
  rmSync(deployDir, { recursive: true, force: true });
  // 再跑一次冻结安装把 pnpm 的内部状态对齐（deploy 会在 workspace 内留痕，仅清目录不足以恢复；
  // 已是最新时它是无网络、毫秒级、不修改 lockfile 的幂等操作）。
  try {
    run(PNPM, ["install", "--frozen-lockfile"]);
  } catch {
    console.warn("[pack] 冻结安装恢复失败（不影响已产出的安装包）");
  }
}
