/**
 * prepack 钩子 —— 发布前把 workspace:* 依赖替换为真实版本号（借鉴 @actalk/inkos 机制）。
 *
 * 调用方式（各可发布包 package.json）：
 *   "prepack": "node ../../scripts/prepare-package-for-publish.mjs"
 * pnpm/npm 保证 process.cwd() 为包目录（packages/<name>）。
 *
 * 替换规则（normalizeWorkspaceSpecifier）：workspace:* → 真实版本；workspace:^ → ^版本；
 * workspace:~ → ~版本；workspace:1.2.3 → 原样。
 * 无 workspace: 依赖时直接跳过（不做备份/写入，避免无谓 churn）。
 * 备份到 .package.json.publish-backup，postpack 恢复；校验残留 workspace: 则恢复并退出 1。
 * 原子写：临时文件 + rename（决策 11 精神，避免中断半写）。
 */
import { readFile, writeFile, copyFile, rm, rename, readdir } from "node:fs/promises";
import { join, dirname } from "node:path";

const packageDir = process.cwd();
const packageJsonPath = join(packageDir, "package.json");
const backupPath = join(packageDir, ".package.json.publish-backup");

async function writeAtomic(path, content) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

/** 向上查找 workspace 根（含 pnpm-workspace.yaml 的目录） */
async function findWorkspaceRoot(startDir) {
  let dir = startDir;
  for (let i = 0; i < 10; i++) {
    try {
      await readFile(join(dir, "pnpm-workspace.yaml"), "utf-8");
      return dir;
    } catch {
      dir = dirname(dir);
    }
  }
  throw new Error("Could not find workspace root (pnpm-workspace.yaml)");
}

/** 读取 packages 下各子包的 package.json（名字 → 版本映射） */
async function loadWorkspaceVersions(workspaceRoot) {
  const packagesDir = join(workspaceRoot, "packages");
  const entries = await readdir(packagesDir, { withFileTypes: true });
  const versions = new Map();
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      const raw = await readFile(join(packagesDir, entry.name, "package.json"), "utf-8");
      const pkg = JSON.parse(raw);
      versions.set(pkg.name, pkg.version);
    } catch {
      // 非包目录（缺 package.json）跳过
    }
  }
  return versions;
}

function normalizeWorkspaceSpecifier(specifier, version) {
  const value = specifier.slice("workspace:".length);
  if (value === "*" || value === "") return version;
  if (value === "^") return `^${version}`;
  if (value === "~") return `~${version}`;
  return value;
}

async function main() {
  const raw = await readFile(packageJsonPath, "utf-8");
  const pkg = JSON.parse(raw);

  // 扫描是否存在 workspace: 依赖
  let hasWorkspaceDeps = false;
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const specifier of Object.values(deps)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        hasWorkspaceDeps = true;
        break;
      }
    }
    if (hasWorkspaceDeps) break;
  }
  if (!hasWorkspaceDeps) {
    process.stderr.write(`[prepack] ${pkg.name}: 无 workspace: 依赖，跳过\n`);
    return;
  }

  const workspaceRoot = await findWorkspaceRoot(packageDir);
  const versions = await loadWorkspaceVersions(workspaceRoot);

  // 备份原 package.json
  await copyFile(packageJsonPath, backupPath);

  for (const field of ["dependencies", "optionalDependencies", "peerDependencies", "devDependencies"]) {
    const deps = pkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier !== "string" || !specifier.startsWith("workspace:")) continue;
      const version = versions.get(name);
      if (!version) {
        throw new Error(`Unable to resolve workspace dependency version for "${name}"`);
      }
      deps[name] = normalizeWorkspaceSpecifier(specifier, version);
    }
  }

  await writeAtomic(packageJsonPath, `${JSON.stringify(pkg, null, 2)}\n`);
  process.stderr.write(`[prepack] ${pkg.name}: workspace:* 已替换为真实版本号\n`);

  // 校验：dependencies 中不得残留 workspace:
  const verifyRaw = await readFile(packageJsonPath, "utf-8");
  const verifyPkg = JSON.parse(verifyRaw);
  const violations = [];
  for (const field of ["dependencies", "optionalDependencies", "peerDependencies"]) {
    const deps = verifyPkg[field];
    if (!deps) continue;
    for (const [name, specifier] of Object.entries(deps)) {
      if (typeof specifier === "string" && specifier.startsWith("workspace:")) {
        violations.push(`  ${field}.${name}: ${specifier}`);
      }
    }
  }
  if (violations.length > 0) {
    process.stderr.write(
      `[prepack] FATAL: workspace: 引用残留！\n${violations.join("\n")}\n`,
    );
    const original = await readFile(backupPath, "utf-8");
    await writeAtomic(packageJsonPath, original);
    await rm(backupPath, { force: true });
    process.exit(1);
  }
}

await main();
