#!/usr/bin/env node
// 发布 6 包脚本（E6，借鉴 static-web-data 的判重幂等 + inkos 的 tarball workspace: 防线）。
//
// 用法：
//   node scripts/publish-packages.mjs            # 发布 6 包（依赖序；已存在版本跳过）
//   node scripts/publish-packages.mjs --tag v0.2.0  # 校验 tag 与各包版本一致（不一致退出）
//   node scripts/publish-packages.mjs --dry-run  # 只跑检查（判重/防线/tag），不真 publish
//
// 流程（每包）：
//   1. tag 版本一致性校验（可选，--tag 或环境变量 GITHUB_REF=refs/tags/vX.Y.Z）：
//      包 version 与 tag 版本不等 → 报错退出（防止 tag 与代码版本漂移误发）
//   2. npm view <name>@<version> version 判重——已存在跳过（发布中途失败重跑安全）
//   3. tarball workspace: 防线：真实 npm pack 到临时目录，读包内 package.json grep
//      "workspace:"——残留即 abort（prepack 钩子替换失败的兜底；发布前的最后一道闸）
//   4. npm publish --access public（cwd=包目录；prepack 钩子自动执行替换与恢复）
//
// 认证：Trusted Publishing（OIDC）——CI 内无 NODE_AUTH_TOKEN，npmjs 侧每包配置
// Trusted Publisher 后自动换取发布凭证（见 README 发布说明）。
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** 依赖发布顺序（内部依赖先发；映射 @whispering233/ai-editor-<name>，与 pnpm-workspace 一致） */
const PUBLISH_ORDER = ["shared", "llm", "db", "tools", "agent", "server"];

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const tagArg = args.find((a) => a.startsWith("--tag="))?.slice("--tag=".length);

/** 从 GITHUB_REF（refs/tags/vX.Y.Z）或 --tag 提取版本号；无则返回 null（跳过校验） */
function tagVersion() {
  const ref = process.env.GITHUB_REF ?? "";
  if (ref.startsWith("refs/tags/")) {
    const tag = ref.slice("refs/tags/".length);
    return tag.startsWith("v") ? tag.slice(1) : tag;
  }
  if (tagArg) return tagArg.startsWith("v") ? tagArg.slice(1) : tagArg;
  return null;
}

function run(cmd, argsList, opts = {}) {
  return execFileSync(cmd, argsList, { encoding: "utf-8", ...opts });
}

/** 读取包 package.json */
function readPkg(dir) {
  return JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
}

/**
 * tarball workspace: 防线（inkos 三重防线之一）：
 * 真实 npm pack 到临时目录（触发 prepack/postpack 钩子），读包内 package.json
 * 检查无 "workspace:" 残留——prepack 替换失败的最终兜底，有残留即抛错不发布。
 * @returns { tmpDir, tgzPath } 调用方在发布后清理 tmpDir
 */
function packAndCheckWorkspace(pkgDir, pkgName) {
  const tmpDir = mkdtempSync(join(tmpdir(), "ai-editor-publish-"));
  try {
    run("npm", ["pack", "--pack-destination", tmpDir], { cwd: pkgDir, stdio: "pipe" });
    const tgz = readdirSync(tmpDir).find((f) => f.endsWith(".tgz"));
    if (!tgz) throw new Error(`${pkgName}: pack 未产出 tarball`);
    // 读包内 package.json 检查 workspace: 残留（tar -xOf 解包单文件到 stdout）
    const inner = run("tar", ["-xOf", join(tmpDir, tgz), "package/package.json"], { stdio: "pipe" });
    if (inner.includes("workspace:")) {
      throw new Error(`${pkgName}: tarball 内仍含 "workspace:" 引用（prepack 替换失败），已中止发布`);
    }
    return { tmpDir, tgzPath: join(tmpDir, tgz) };
  } catch (err) {
    rmSync(tmpDir, { recursive: true, force: true });
    throw err;
  }
}

const version = tagVersion();
if (version) console.log(`[publish] tag 版本: v${version}（GITHUB_REF 或 --tag）`);

for (const name of PUBLISH_ORDER) {
  const pkgName = `@whispering233/ai-editor-${name}`;
  const pkgDir = join(process.cwd(), "packages", name);
  const pkg = readPkg(pkgDir);

  // 1. tag 一致性（防 tag 与代码版本漂移误发）
  if (version && pkg.version !== version) {
    console.error(`[publish] ${pkgName}: 包版本 ${pkg.version} ≠ tag 版本 ${version}——中止（先跑 sync-version 对齐）`);
    process.exit(1);
  }

  // 2. 判重（幂等重跑安全）：E404 = 未发布 → 继续发布；网络/registry 其它错误 → 中止
  //   （不能把网络错误误判为「未发布」而重复发布）
  let exists = false;
  try {
    const remote = run("npm", ["view", `${pkgName}@${pkg.version}`, "version"], {
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    exists = remote.length > 0;
  } catch (err) {
    const stderr = err.stderr ?? "";
    if (!stderr.includes("E404")) {
      console.error(`[publish] ${pkgName}: npm view 失败（非 404，疑似网络/registry 错误），中止：\n${stderr.trim()}`);
      process.exit(1);
    }
    exists = false; // E404 = 该版本未发布
  }
  if (exists) {
    console.log(`[publish] ${pkgName}@${pkg.version} 已存在于 registry，跳过`);
    continue;
  }
  console.log(`[publish] ${pkgName}@${pkg.version} 未发布，${dryRun ? "[dry-run] 跳过发布" : "开始发布"}`);

  // 3. tarball workspace: 防线（真实 pack，触发 prepack 替换钩子）
  const { tmpDir } = packAndCheckWorkspace(pkgDir, pkgName);
  try {
    // 4. 发布（cwd=包目录）
    //    ⚠ npm 12 的 publish 时序：manifest 在 postpack 恢复**之后**从磁盘读取——
    //    任何经 prepack/postpack 钩子的替换都会在 manifest 生成前被恢复，导致
    //    registry manifest 残留 workspace:*（npm install 报 EUNSUPPORTEDPROTOCOL）。
    //    修复：发布前主动执行「copy-client-dist（server 的 SPA 随包）+ workspace:*
    //    替换」，npm publish 加 --ignore-scripts 跳过全部钩子——manifest 与 tarball
    //    都基于替换后的 package.json（一致）；发布后 finally 主动恢复（幂等）。
    //    ⚠ OIDC 认证：CI 中 setup-node 会注入占位 NODE_AUTH_TOKEN（XXXXX-…），npm
    //    检测到它时优先使用（而非 Trusted Publishing 的 OIDC）→ 无效凭据被 npmjs
    //    以 404 保护性拒绝。发布前必须删除，让 npm 自动检测 GitHub Actions 的
    //    OIDC 环境变量（ACTIONS_ID_TOKEN_REQUEST_URL）走 Trusted Publisher。
    if (!dryRun) {
      if (name === "server") {
        run("node", ["../../scripts/copy-client-dist.mjs"], { cwd: pkgDir });
      }
      run("node", ["../../scripts/prepare-package-for-publish.mjs"], { cwd: pkgDir });
      delete process.env.NODE_AUTH_TOKEN; // 占位 token 优先于 OIDC，必须清除（见上）
      // 诊断（OIDC 换证调试用）：环境变量存在性 + npm 版本 + 请求的 OIDC token claims
      if (process.env.CI) {
        const hasOidcEnv = Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN);
        console.log(`[publish] 诊断: OIDC 环境=${hasOidcEnv ? "有" : "无"} npm=${run("npm", ["--version"]).trim()} registry=${run("npm", ["config", "get", "registry"]).trim()}`);
      }
      try {
        run("npm", ["publish", "--access", "public", "--ignore-scripts"], { cwd: pkgDir });
      } finally {
        run("node", ["../../scripts/restore-package-json.mjs"], { cwd: pkgDir });
      }
      console.log(`[publish] ${pkgName}@${pkg.version} 发布成功`);
    } else {
      console.log(`[publish] [dry-run] ${pkgName}@${pkg.version}（tarball 防线已通过，未发布）`);
    }
  } finally {
    rmSync(tmpDir, { recursive: true, force: true }); // 清理 pack 临时目录
  }
}

console.log(`[publish] 全部完成（${dryRun ? "dry-run，未真发布" : `已发布 ${PUBLISH_ORDER.length} 包`}）`);
