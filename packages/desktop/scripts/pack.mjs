#!/usr/bin/env node
// 桌面版打包：pnpm deploy（自包含扁平依赖）→ electron-builder（asar + 安装包）。
//
// 为什么不让 electron-builder 自己收依赖：pnpm 的符号链接树会让它漏收 `@whispering233/*`
// workspace 包（`docs/design/50-desktop.md` §5）。deploy 负责依赖，builder 只管安装包。
import { execFileSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
const workspaceRoot = join(pkgDir, "..", "..");
const packageName = "@whispering233/ai-editor-desktop";
const deployDir = join(pkgDir, ".deploy");
const deployApp = join(deployDir, "app");

/**
 * 是否经 shell 执行子进程：**Windows 上必须**——pnpm 在那里是 `.cmd` 包装脚本，而 Node 20+
 * （CVE-2024-27980 的修补）**禁止直接 spawn `.bat`/`.cmd`**：不带 shell 是 `spawnSync pnpm ENOENT`，
 * 指定 `pnpm.cmd` 则是 `spawnSync pnpm.cmd EINVAL`（v0.0.40 的 Windows 打包 job 两次实测踩到）。
 * 已核实的官方解法就是 `shell: true`（nodejs/node#52681）。
 *
 * 前提：**当前所有参数均不含空格**（仓库路径、`--filter` 包名、子命令与开关皆然）。
 * 若将来出现含空格的参数（如含空格的用户路径），必须改为显式加引号或换用 cross-spawn。
 */
const USE_SHELL = process.platform === "win32";

/** 同步执行并继承 stdio（打包过程需可见；失败即抛，由调用方脚本链中断） */
function run(cmd, args, cwd = pkgDir) {
  execFileSync(cmd, args, { cwd, stdio: "inherit", shell: USE_SHELL });
}

/**
 * 校验 deploy 产物里真的带上了 SPA。
 *
 * 为什么必须有：server 的 SPA 走「<server>/client-dist」兜底路径（`server/src/index.ts` 的
 * `resolveClientDist`），而该目录**只在 server 包 prepack 时生成**；deploy 直接收依赖会漏掉它——
 * 结果是包能启动、窗口却只显示 `client/dist 未构建` 的 404 JSON（v0.0.40 的 Windows 包实测踩到，
 * 本地因为残留的旧目录而没暴露）。宁可在打包阶段红，也不要发一个坏包出去。
 */
function assertSpaBundled() {
  const spaIndex = join(
    deployApp,
    "node_modules",
    "@whispering233",
    "ai-editor-server",
    "client-dist",
    "index.html",
  );
  if (!existsSync(spaIndex)) {
    throw new Error(
      `打包校验失败：deploy 产物缺 SPA（${spaIndex}）——请先 pnpm -r build，再重跑（脚本会先执行 copy-client-dist）`,
    );
  }
}

rmSync(deployDir, { recursive: true, force: true });

try {
  // 先把 SPA 复制到 server 包（与 npm 发布链路的 prepack 用同一个脚本，单一实现）；
  // 必须在 deploy 之前——deploy 只收 server 包 package.json `files` 里已存在的目录。
  run(process.execPath, [join(workspaceRoot, "scripts", "copy-client-dist.mjs")]);

  // pnpm 12.2+ 的 deploy 默认实现不再要求 injected workspace（链接的 workspace 依赖会改写成 file:）
  run("pnpm", ["--filter", packageName, "deploy", "--prod", deployApp]);
  assertSpaBundled();

  // 目标平台参数透传（如 `--linux AppImage` / `--mac dmg` / `--win nsis`），缺省用配置里的默认
  run("pnpm", ["exec", "electron-builder", "--config", "electron-builder.yml", ...process.argv.slice(2)]);
} finally {
  // 必须清：`.deploy/app` 里有 workspace 外的 package.json + node_modules，会让 pnpm 的依赖状态
  // 检查误判（后续任何 pnpm 脚本都报「需重建 modules 目录」）；产物已在 release/，无保留价值。
  rmSync(deployDir, { recursive: true, force: true });
  // 再跑一次冻结安装把 pnpm 的内部状态对齐（deploy 会在 workspace 内留痕，仅清目录不足以恢复；
  // 已是最新时它是无网络、毫秒级、不修改 lockfile 的幂等操作）。
  try {
    run("pnpm", ["install", "--frozen-lockfile"]);
  } catch {
    console.warn("[pack] 冻结安装恢复失败（不影响已产出的安装包）");
  }
}
