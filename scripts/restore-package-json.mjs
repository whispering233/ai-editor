/**
 * postpack 钩子 —— 恢复被 prepack 替换的原始 package.json（借鉴 @actalk/inkos 机制）。
 *
 * 调用方式（各可发布包 package.json）：
 *   "postpack": "node ../../scripts/restore-package-json.mjs"
 * 从 .package.json.publish-backup 恢复原文件后删除备份；无备份（prepack 跳过）则静默。
 * 原子写：临时文件 + rename。
 */
import { readFile, rm, writeFile, rename } from "node:fs/promises";
import { join } from "node:path";

const packageJsonPath = join(process.cwd(), "package.json");
const backupPath = join(process.cwd(), ".package.json.publish-backup");

async function writeAtomic(path, content) {
  const tempPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tempPath, content, "utf-8");
  await rename(tempPath, path);
}

async function main() {
  try {
    const original = await readFile(backupPath, "utf-8");
    await writeAtomic(packageJsonPath, original);
    await rm(backupPath, { force: true });
    process.stderr.write("[postpack] package.json 已恢复\n");
  } catch {
    // 无备份 = prepack 无 workspace: 可替换，静默
  }
}

await main();
