#!/usr/bin/env node
// 打包态启动冒烟：起一次 `release/<platform>-unpacked` 里的产物，断言主进程真的走到了「菜单已就绪」。
//
// 为什么必须有：`typecheck` / `lint` / 单测全绿 ≠ 打包态能起——v0.0.44 的 `updater.ts` 用
// `import { autoUpdater } from "electron-updater"`（CJS 包）在打包态直接 `SyntaxError`，而三种检查
// 全绿（`docs/design/build.md`「打包态启动冒烟不可省」）。CI 只验「包能构建」拦不住这类回归。
//
// 用法：先 `pack.mjs`，再 `node packages/desktop/scripts/smoke.mjs`。`--user-data-dir=<临时目录>`
// 让日志落到 `<临时目录>/logs/ai-editor.log`（`log.ts` 的落盘路径 = `<userData>/logs/`），不碰机器上
// 真实的 `<userData>` 与 `<文档>/AI Editor` 书库配置。
import { execFileSync, spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** 主判据（`main.ts` 在窗口创建 + 装菜单之后打的那一行）：窗口真的建出来了 */
const MENU_READY = "菜单已就绪";
/**
 * 退路判据：主进程跑到 in-process server 启动成功那一行（`main.ts` 在 `startServer` 之后打）。
 * 用于「runner 无交互会话 ⇒ 建不出窗口」的退化——此时主判据永远不来，但仍能区分「起不来」
 * 与「起来了、只是没有桌面会话」；命中时打 `::warning::` 标注实际走的是退路。
 */
const SERVER_READY = "[desktop] server: http://127.0.0.1:";
/** 打包态才暴露的致命形态（ESM 具名导入 CJS 包 / 主进程未捕获异常） */
const FATAL_MARKERS = ["SyntaxError", "Uncaught Exception"];
/** 等待上限：慢 runner 上首启要解 asar + 加载原生模块，给足余量 */
const TIMEOUT_MS = 90_000;
const POLL_MS = 500;

const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));

function fail(lines) {
  for (const line of lines) console.error(line);
  process.exit(1);
}

if (!existsSync(join(pkgDir, "release"))) {
  fail(["[smoke] 找不到 packages/desktop/release——先跑 `node packages/desktop/scripts/pack.mjs`"]);
}
// 平台目录名沿用 electron-builder 约定（linux 矩阵项恢复后同一条链路可用）
const exe = join(
  pkgDir,
  "release",
  process.platform === "win32" ? "win-unpacked/ai-editor.exe" : "linux-unpacked/ai-editor",
);
if (!existsSync(exe)) {
  fail([`[smoke] 找不到打包产物 ${exe}（打包失败或产物名变了）`]);
}

// 临时 userData 用完不删：日志是失败后唯一的线索（CI 机一次性，本地 /tmp 也要留证据）
const userData = mkdtempSync(join(tmpdir(), "ai-editor-smoke-"));
const logFile = join(userData, "logs", "ai-editor.log");
console.log(`[smoke] 启动 ${exe} --user-data-dir=${userData}`);

let output = ""; // 进程自身 stdout/stderr：模块加载期的 SyntaxError 只在这里，进不了日志文件
const child = spawn(exe, [`--user-data-dir=${userData}`], { stdio: ["ignore", "pipe", "pipe"] });
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));

const readLog = () => (existsSync(logFile) ? readFileSync(logFile, "utf8") : "");
const fatalIn = (text) => FATAL_MARKERS.find((marker) => text.includes(marker)) ?? null;

/** 收尾：连同渲染 / GPU 子进程一起杀（win 上 node 的 kill 只杀主进程，会留一堆孤儿） */
function killTree() {
  if (process.platform !== "win32") {
    child.kill("SIGKILL");
    return;
  }
  try {
    execFileSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
  } catch {
    // 已经自己退了
  }
}

const deadline = Date.now() + TIMEOUT_MS;
let fatal = null;
while (Date.now() < deadline) {
  const log = readLog();
  if (log.includes(MENU_READY)) break;
  fatal = fatalIn(log) ?? fatalIn(output);
  if (fatal !== null) break; // 建窗失败的对话框会让进程一直挂着，不必等满超时
  if (child.exitCode !== null) break; // 自己退了 = 启动失败，日志已写完
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}

const log = readLog();
killTree();

fatal = fatalIn(log) ?? fatalIn(output);
if (fatal !== null) {
  fail([`[smoke] 失败：日志/输出出现致命标记「${fatal}」`, "--- 日志 ---", log, "--- 进程输出 ---", output]);
}
if (log.includes(MENU_READY)) {
  console.log(`[smoke] 通过（主判据）：主进程建出窗口并装好菜单，日志 ${logFile}`);
  process.exit(0);
}
if (log.includes(SERVER_READY)) {
  // 退路：见上方 SERVER_READY 的注释。::warning:: 让绿色的 run 也留下「走的是退路」的痕迹。
  console.log(`::warning::[smoke] 走退路判据：日志有 server 启动行但没有「${MENU_READY}」（runner 可能无可建窗口的交互会话）——日志 ${logFile}`);
  process.exit(0);
}
fail([
  `[smoke] 失败：${TIMEOUT_MS / 1000}s 内既没有「${MENU_READY}」也没有「${SERVER_READY}」（进程退出码 ${child.exitCode}）`,
  `--- 日志(${logFile}) ---`,
  log,
  "--- 进程输出 ---",
  output,
]);