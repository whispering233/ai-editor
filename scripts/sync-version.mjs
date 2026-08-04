#!/usr/bin/env node
// 版本同步脚本（E6）：一键同步 6 个发布包 + 根 + client 的 version 字段。
//
// 用法：
//   node scripts/sync-version.mjs 0.2.0          # 同步全部包版本为 0.2.0
//   node scripts/sync-version.mjs 0.2.0 --dry-run # 只输出将改动的文件，不写盘
//
// 同步范围：packages/{shared,llm,db,tools,agent,server,client} + 根 package.json。
// client 虽 private 不发布，但保持仓库内版本一致（发布流程只发 6 包）。
// 校验：semver 格式 /^\d+\.\d+\.\d+(-[\w.]+)?$/（含预发布后缀如 0.2.0-beta.1）。
// 输出：改动的文件清单（dry-run 时标注「将改动」）。
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const version = args.find((a) => !a.startsWith("--"));

if (!version) {
  console.error("用法: node scripts/sync-version.mjs <version> [--dry-run]");
  process.exit(1);
}
if (!/^\d+\.\d+\.\d+(-[\w.]+)?$/.test(version)) {
  console.error(`版本号格式非法: ${version}（需 semver：主.次.补丁，可含 -预发布 后缀）`);
  process.exit(1);
}

const PACKAGES = ["shared", "llm", "db", "tools", "agent", "server", "client"];
const rootPkgPath = join(workspaceRoot, "package.json");

/** 读取并返回 JSON 对象 */
async function readJson(path) {
  return JSON.parse(await readFile(path, "utf-8"));
}

/** 写回 JSON（保持 2 空格缩进 + 尾换行，与 pnpm 写入风格一致） */
async function writeJson(path, obj) {
  await writeFile(path, `${JSON.stringify(obj, null, 2)}\n`, "utf-8");
}

const changed = [];

// 各包
for (const name of PACKAGES) {
  const path = join(workspaceRoot, "packages", name, "package.json");
  const pkg = await readJson(path);
  if (pkg.version === version) continue; // 已同版本，跳过
  changed.push(`${path}: ${pkg.version} → ${version}`);
  if (!dryRun) {
    pkg.version = version;
    await writeJson(path, pkg);
  }
}

// 根
const rootPkg = await readJson(rootPkgPath);
if (rootPkg.version !== version) {
  changed.push(`${rootPkgPath}: ${rootPkg.version} → ${version}`);
  if (!dryRun) {
    rootPkg.version = version;
    await writeJson(rootPkgPath, rootPkg);
  }
}

if (changed.length === 0) {
  console.log(`全部包已是 ${version}，无改动`);
} else {
  console.log(dryRun ? `[dry-run] 将改动 ${changed.length} 个文件:` : `已同步 ${changed.length} 个文件到 ${version}:`);
  for (const line of changed) console.log(`  ${line}`);
}

// 一致性提示：确认 6 个发布包版本一致（发布脚本依赖此不变式）
const publishVersions = new Set();
for (const name of PACKAGES) {
  const pkg = await readJson(join(workspaceRoot, "packages", name, "package.json"));
  publishVersions.add(pkg.version);
}
if (publishVersions.size > 1) {
  console.warn(`警告: 发布包版本不一致（${[...publishVersions].join(", ")}）——发布脚本按单版本发布，请先 sync-version 对齐`);
}
