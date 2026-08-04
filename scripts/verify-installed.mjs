#!/usr/bin/env node
// 安装态验证脚本（E6）：CI 发布后冒烟 —— 临时目录真实 `npm install @ai-editor/server@<version>`，
// 断言 bin 链接与版本正确，再短时启动服务验证「服务已启动」输出（发布链路的最后一道闸）。
//
// 用法：
//   node scripts/verify-installed.mjs           # 版本默认读 packages/server/package.json
//   node scripts/verify-installed.mjs 0.2.0     # 显式指定版本（一般不需要）
//
// 流程：
//   1. mkdtemp 临时安装目录 + 临时空项目目录
//   2. `npm install --prefix <安装目录> @ai-editor/server@<version>`（真实 registry 拉包与依赖）
//   3. 断言 node_modules/@ai-editor/server/package.json 存在且 version 匹配
//   4. 断言 node_modules/.bin/ai-editor 存在（npm 生成的 bin 链接；win32 为 .cmd shim）
//   5. 冒烟：`node <server>/dist/index.js <临时空目录>`（AI_EDITOR_PORT 随机端口避免冲突），
//      收集 stdout，出现「服务已启动」即 kill；超时未见 → 失败并打印输出
//   6. 清理临时目录（finally 兜底）
//
// 说明：ESM 下读 package.json 用 readFile + JSON.parse（不引入 import assertions / 新依赖）。
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versionArg = process.argv[2];

/** 启动成功标志（server 直接执行入口的固定输出，见 packages/server/src/index.ts） */
const READY_MARKER = "服务已启动";
/** 冒烟等待超时（毫秒）；启动含 better-sqlite3 原生加载，给足余量 */
const SMOKE_TIMEOUT_MS = 20_000;

/** 读取 server 包版本（spec：ESM 下 readFile + JSON.parse） */
function readServerVersion() {
  const raw = readFileSync(join(workspaceRoot, "packages", "server", "package.json"), "utf-8");
  return JSON.parse(raw).version;
}

function assert(cond, message) {
  if (!cond) {
    console.error(`[verify] FAIL: ${message}`);
    process.exit(1);
  }
}

const version = versionArg ?? readServerVersion();
console.log(`[verify] 安装态验证 @ai-editor/server@${version}`);

const installDir = mkdtempSync(join(tmpdir(), "ai-editor-verify-install-"));
const projectDir = mkdtempSync(join(tmpdir(), "ai-editor-verify-proj-"));

try {
  // 2. 真实安装（registry 拉包；--no-fund/--no-audit 减噪；失败时打印输出）
  console.log(`[verify] npm install --prefix ${installDir} @ai-editor/server@${version}`);
  try {
    execFileSync(
      "npm",
      ["install", "--prefix", installDir, "--no-fund", "--no-audit", "--loglevel", "error", `@ai-editor/server@${version}`],
      { stdio: "inherit", timeout: 300_000 },
    );
  } catch (err) {
    console.error(`[verify] FAIL: npm install 失败（exit ${err.status}）`);
    process.exit(1);
  }

  // 3. 断言已安装包版本
  const serverPkgPath = join(installDir, "node_modules", "@ai-editor", "server", "package.json");
  assert(existsSync(serverPkgPath), `已安装包 package.json 不存在: ${serverPkgPath}`);
  const installedPkg = JSON.parse(readFileSync(serverPkgPath, "utf-8"));
  assert(
    installedPkg.version === version,
    `已安装版本 ${installedPkg.version} ≠ 期望 ${version}`,
  );
  console.log(`[verify] OK: 版本匹配（${installedPkg.version}）`);

  // 4. 断言 bin 链接（POSIX 符号链接 / win32 .cmd shim）
  const binPaths = [
    join(installDir, "node_modules", ".bin", "ai-editor"),
    join(installDir, "node_modules", ".bin", "ai-editor.cmd"),
  ];
  assert(binPaths.some((p) => existsSync(p)), `bin 链接不存在: ${binPaths.join(" / ")}`);
  console.log(`[verify] OK: bin 链接存在（${binPaths.find((p) => existsSync(p))}）`);

  // 5. 冒烟启动：等「服务已启动」出现即成功 kill；超时/退出过早 → 失败
  const serverIndex = join(installDir, "node_modules", "@ai-editor", "server", "dist", "index.js");
  assert(existsSync(serverIndex), `server dist 入口不存在: ${serverIndex}`);
  const port = 20_000 + Math.floor(Math.random() * 20_000); // 随机端口，避免与本地服务冲突
  const child = spawn(process.execPath, [serverIndex, projectDir], {
    env: { ...process.env, AI_EDITOR_PORT: String(port) },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk.toString()));
  child.stderr.on("data", (chunk) => (output += chunk.toString()));

  const ready = await new Promise((resolveReady) => {
    const timer = setTimeout(() => resolveReady(false), SMOKE_TIMEOUT_MS);
    const onData = () => {
      if (output.includes(READY_MARKER)) {
        clearTimeout(timer);
        resolveReady(true);
      }
    };
    child.stdout.on("data", onData);
    child.on("exit", () => {
      clearTimeout(timer);
      resolveReady(false); // 启动未就绪即退出 → 失败
    });
  });

  child.kill("SIGTERM");
  await new Promise((r) => child.once("exit", r));
  assert(ready, `服务未在 ${SMOKE_TIMEOUT_MS}ms 内输出「${READY_MARKER}」。进程输出:\n${output}`);
  console.log(`[verify] OK: 冒烟启动成功（输出含「${READY_MARKER}」）`);
  console.log(`[verify] 全部通过：@ai-editor/server@${version} 安装态可用`);
} finally {
  rmSync(installDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}
