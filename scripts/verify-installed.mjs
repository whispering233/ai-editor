#!/usr/bin/env node
// 安装态验证脚本（E6）：CI 发布后冒烟 —— 临时目录真实 `npm install @whispering233/ai-editor-server@<version>`，
// 断言 bin 链接与版本正确，再短时启动服务验证「服务已启动」输出（发布链路的最后一道闸）。
//
// 用法：
//   node scripts/verify-installed.mjs           # 版本默认读 packages/server/package.json
//   node scripts/verify-installed.mjs 0.2.0     # 显式指定版本（一般不需要）
//
// 流程：
//   1. mkdtemp 临时安装目录 + 临时空项目目录
//   2. 【发布可见性轮询】`npm view <6 包>@<version>` 循环确认全部可见（registry manifest CDN
//      传播延迟，实测最慢可超 5 分钟——2026-08 v0.0.6 曾 10×30s=5 分钟窗口仍 ETARGET 超窗；
//      窗口 20×30s = 10 分钟；npm view 与 install 同源，可见后再装基本一次成功）
//   3. `npm install --prefix <安装目录> @whispering233/ai-editor-server@<version>`（真实 registry 拉包与依赖）
//   4. 断言 node_modules/@whispering233/ai-editor-server/package.json 存在且 version 匹配
//   5. 断言 node_modules/.bin/ai-editor 存在（npm 生成的 bin 链接；win32 为 .cmd shim）
//   6. 冒烟：`node <server>/dist/index.js <临时空目录>`（AI_EDITOR_PORT 随机端口避免冲突），
//      收集 stdout，出现「服务已启动」即 kill；超时未见 → 失败并打印输出
//   7. 清理临时目录（finally 兜底）
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

/** 发布包名后缀（server 依赖其余 5 包，install 需全部可见；与 publish-packages.mjs 同序） */
const PUBLISHED_PACKAGES = ["shared", "llm", "db", "tools", "agent", "server"];
/** 可见性轮询：最多 20 次 × 30s = 10 分钟窗口（v0.0.6 实录：传播最慢超 5 分钟） */
const VISIBILITY_POLLS = 20;
const VISIBILITY_POLL_INTERVAL_MS = 30_000;

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

/** 6 个发布包是否全部在 registry 可见（npm view 成功且版本匹配；与 npm install 同源判定） */
function allPackagesVisible() {
  return PUBLISHED_PACKAGES.every((p) => {
    try {
      const out = execFileSync(
        "npm",
        ["view", `@whispering233/ai-editor-${p}@${version}`, "version"],
        { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"], timeout: 60_000 },
      );
      return out.trim() === version;
    } catch {
      return false; // E404（未传播）或网络错误 → 不可见
    }
  });
}

const version = versionArg ?? readServerVersion();
console.log(`[verify] 安装态验证 @whispering233/ai-editor-server@${version}`);

const installDir = mkdtempSync(join(tmpdir(), "ai-editor-verify-install-"));
const projectDir = mkdtempSync(join(tmpdir(), "ai-editor-verify-proj-"));

try {
  // 2. 发布可见性轮询（先于 install——传播期内轻量轮询，传播一完成立即安装）
  let visible = false;
  for (let attempt = 1; attempt <= VISIBILITY_POLLS && !visible; attempt++) {
    visible = allPackagesVisible();
    if (!visible) {
      if (attempt < VISIBILITY_POLLS) {
        console.warn(
          `[verify] registry 可见性轮询（第 ${attempt}/${VISIBILITY_POLLS} 次：6 包未全部可见 @${version}，${VISIBILITY_POLL_INTERVAL_MS / 1000}s 后重试）`,
        );
        await new Promise((r) => setTimeout(r, VISIBILITY_POLL_INTERVAL_MS));
      }
    }
  }
  if (!visible) {
    console.error(
      `[verify] FAIL: ${PUBLISHED_PACKAGES.length} 包在 ${(VISIBILITY_POLLS * VISIBILITY_POLL_INTERVAL_MS) / 60_000} 分钟内未全部可见 @${version}——版本未发布或网络问题`,
    );
    process.exit(1);
  }
  console.log(`[verify] OK: 6 包 @${version} 已在 registry 可见`);

  // 3. 真实安装（registry 拉包；--no-fund/--no-audit 减噪；失败时打印输出）
  //    兜底重试：轮询已确认可见，install 失败只可能是网络抖动（最多 10 次 × 30s）。
  console.log(`[verify] npm install --prefix ${installDir} @whispering233/ai-editor-server@${version}`);
  let installOk = false;
  for (let attempt = 1; attempt <= 10 && !installOk; attempt++) {
    try {
      execFileSync(
        "npm",
        ["install", "--prefix", installDir, "--no-fund", "--no-audit", "--loglevel", "error", `@whispering233/ai-editor-server@${version}`],
        { stdio: "inherit", timeout: 300_000 },
      );
      installOk = true;
    } catch {
      if (attempt < 10) {
        console.warn(`[verify] npm install 失败（第 ${attempt} 次，30s 后重试）`);
        await new Promise((r) => setTimeout(r, 30_000));
      }
    }
  }
  if (!installOk) {
    console.error(`[verify] FAIL: npm install 失败（10 次重试后仍失败——疑似版本不存在或网络问题）`);
    process.exit(1);
  }

  // 3. 断言已安装包版本
  const serverPkgPath = join(installDir, "node_modules", "@whispering233", "ai-editor-server", "package.json");
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
  const serverIndex = join(installDir, "node_modules", "@whispering233", "ai-editor-server", "dist", "index.js");
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
  console.log(`[verify] 全部通过：@whispering233/ai-editor-server@${version} 安装态可用`);
} finally {
  rmSync(installDir, { recursive: true, force: true });
  rmSync(projectDir, { recursive: true, force: true });
}
