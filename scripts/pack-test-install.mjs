/**
 * 一键「打包 → 安装到测试目录」（根命令 `pnpm pack:test`）。
 *
 * 流程（复用既有机制，不重复实现钩子）：
 *   1. `pnpm -r build` 全仓构建（server 的 prepack 需要 client/dist 与各包 dist）
 *   2. 清空/创建打包目录（默认 /tmp/opencode/ai-editor-packs，可用 AI_EDITOR_PACKS_DIR 覆盖）
 *   3. 6 个可发布包 `pnpm pack`（shared/llm/db/tools/agent/server）——
 *      prepack（workspace:* → 真实版本号）/ postpack（恢复）钩子自动执行，
 *      pack 后仓库 package.json 无残留（git status 干净）
 *   4. 清空/创建安装目录（默认 /tmp/opencode/ai-editor-install-test，可用 AI_EDITOR_TEST_DIR 覆盖）
 *   5. 安装目录 `npm install <全部 tarball>`（npm 对同批 tarball 复用依赖，未发布 registry 也能装）
 *
 * 幂等：重复运行前清空旧打包/安装目录（tarball 与 node_modules 不留旧版残留）。
 * 失败：任一步 execSync 抛错 → 打印 stderr 并 exit 1（不静默）。
 * 成功：打印摘要（安装目录 + 下一步 `pnpm start:test`）。
 */
import { execSync } from "node:child_process";
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
/** 打包目录（环境变量可覆盖） */
const packsDir = process.env.AI_EDITOR_PACKS_DIR ?? "/tmp/opencode/ai-editor-packs";
/** 安装目录（环境变量可覆盖；start:test 的创作根） */
const installDir = process.env.AI_EDITOR_TEST_DIR ?? "/tmp/opencode/ai-editor-install-test";
/** 可发布包（依赖序：server → agent/db/shared → tools/llm；pack 顺序无严格依赖但按此列清晰） */
const PACKAGES = ["shared", "llm", "db", "tools", "agent", "server"];

function run(cmd, opts = {}) {
  console.log(`\n$ ${cmd}`);
  execSync(cmd, { stdio: "inherit", ...opts });
}

// 1. 全仓构建（prepack 的 copy-client-dist 需要 client/dist）
run("pnpm -r build", { cwd: workspaceRoot });

// 2/3. 清空打包目录并 pack 6 包
rmSync(packsDir, { recursive: true, force: true });
mkdirSync(packsDir, { recursive: true });
for (const p of PACKAGES) {
  run(`pnpm --filter @whispering233/ai-editor-${p} pack --pack-destination "${packsDir}"`, { cwd: workspaceRoot });
}

// 4/5. 清空安装目录并安装全部 tarball
rmSync(installDir, { recursive: true, force: true });
mkdirSync(installDir, { recursive: true });
const tarballs = readdirSync(packsDir)
  .filter((f) => f.endsWith(".tgz"))
  .map((f) => `"${join(packsDir, f)}"`)
  .join(" ");
run(`npm install ${tarballs}`, { cwd: installDir });

console.log("\n===== 打包安装完成 =====");
console.log(`打包目录: ${packsDir}`);
console.log(`安装目录: ${installDir}（创作根，书架模式）`);
console.log(`下一步: 运行 pnpm start:test（或 AI_EDITOR_PORT=xxxx pnpm start:test 指定端口）`);
