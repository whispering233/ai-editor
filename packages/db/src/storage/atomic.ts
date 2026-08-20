// @whispering233/ai-editor-db JSON 原子写核心（T2.2）
//
// 单一事实来源：doc/design/decisions.md 决策 11（outline.json 原子写）——
// 「写临时文件 → fsync → rename 覆盖」，禁止直接 writeFileSync 覆盖原文件；
// schema.md 第 186 行：project.json 同款流程。
// 时间约定（schema.md 第 16 行）：所有时间由应用层写入（ISO 8601），模块内不生成时间。

import { closeSync, fsyncSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

/**
 * 当前时间 ISO 8601（UTC）。
 *
 * 仅作为「应用层写时间」的便捷辅助供调用方（server 层）使用——时间戳由应用层
 * 写入数据文件（schema.md 第 16 行约定），本模块的 outline/project 读写接口
 * 一律不隐式生成时间，由调用方显式传入。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

/**
 * JSON 文件原子写（决策 11）：
 *
 * 1. 序列化为 JSON（2 空格缩进 + 尾部换行），写同目录临时文件 `.${basename}.tmp`
 * 2. `fsync` 临时文件——文件数据落盘，崩溃时不会留下半截内容
 * 3. `rename` 覆盖目标文件——POSIX 上同目录 rename 是原子的，
 *    任意时刻磁盘上要么是旧文件、要么是新文件，崩溃/断电不会损坏原文件
 * 4. `fsync` 目录——保证 rename 的目录项也落盘（平台不支持时静默忽略）
 *
 * 失败处理取舍：
 * - rename 成功即代表临时文件已不存在（rename 即移动），无需「成功后清理」；
 * - 失败时**保留临时文件**作为排查现场（内容即失败时写入的数据），不主动清理，
 *   下次写入会先清理残留再以独占方式重建；
 * - 写前清理上次崩溃残留的临时文件（unlink，ENOENT 忽略），并用 `wx` 独占创建，
 *   杜绝并发进程互相覆盖临时文件。
 *
 * @param filePath 目标文件绝对路径（父目录必须存在）
 * @param data 任意可 JSON 序列化的数据
 * @throws 序列化失败 / 目录不可写 / 磁盘错误时抛出，且原文件保持完好
 */
export function writeJsonAtomic(filePath: string, data: unknown): void {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.tmp`);
  let fd: number | undefined;
  try {
    // 清理上次崩溃可能残留的临时文件（ENOENT 忽略，其余错误上抛）
    try {
      unlinkSync(tmpPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    const payload = `${JSON.stringify(data, null, 2)}\n`;
    // "wx"：独占创建——若存在文件（含并发竞争）立即失败，绝不覆盖他人临时文件
    fd = openSync(tmpPath, "wx", 0o644);
    writeFileSync(fd, payload);
    fsyncSync(fd); // 文件数据落盘后再 rename
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath); // 原子覆盖
    fsyncDir(dir);
  } catch (err) {
    // 失败：关闭可能还开着的 fd，保留临时文件供排查，异常向上抛（原文件未被触碰）
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // 忽略关闭失败，原始异常优先
      }
    }
    throw err;
  }
}

/**
 * fsync 目录，确保 rename 的目录项持久化。
 * 部分平台（如 Windows）不支持对目录 open/fsync，失败时静默忽略——
 * 主链路（文件 fsync + rename）已保证文件内容完整，目录项未落盘仅意味着
 * 断电后文件可能回到旧版本，属可接受的降级。
 */
function fsyncDir(dir: string): void {
  let dfd: number | undefined;
  try {
    dfd = openSync(dir, "r");
    fsyncSync(dfd);
  } catch {
    // 平台不支持目录 fsync 时忽略
  } finally {
    if (dfd !== undefined) {
      try {
        closeSync(dfd);
      } catch {
        // 忽略
      }
    }
  }
}

/**
 * 文本文件原子写（决策 11 同款流程：临时文件 + fsync + rename，schema.md 第 186 行）。
 * 与 writeJsonAtomic 的区别：内容为**原始文本**（不 JSON 序列化）——AGENTS.md 等
 * 非 JSON 数据文件用（决策 41：项目规则文件写入走原子写，防崩溃/断电损坏）。
 *
 * @param filePath 目标文件绝对路径（父目录必须存在）
 * @param content 文本内容（原样写入，不追加换行）
 * @throws 目录不可写 / 磁盘错误时抛出，且原文件保持完好
 */
export function writeTextAtomic(filePath: string, content: string): void {
  const dir = dirname(filePath);
  const tmpPath = join(dir, `.${basename(filePath)}.tmp`);
  let fd: number | undefined;
  try {
    // 清理上次崩溃可能残留的临时文件（ENOENT 忽略，其余错误上抛）
    try {
      unlinkSync(tmpPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    // "wx"：独占创建——若存在文件（含并发竞争）立即失败，绝不覆盖他人临时文件
    fd = openSync(tmpPath, "wx", 0o644);
    writeFileSync(fd, content);
    fsyncSync(fd); // 文件数据落盘后再 rename
    closeSync(fd);
    fd = undefined;
    renameSync(tmpPath, filePath); // 原子覆盖
    fsyncDir(dir);
  } catch (err) {
    // 失败：关闭可能还开着的 fd，保留临时文件供排查，异常向上抛（原文件未被触碰）
    if (fd !== undefined) {
      try {
        closeSync(fd);
      } catch {
        // 忽略关闭失败，原始异常优先
      }
    }
    throw err;
  }
}

/** 读取 UTF-8 文本文件；文件不存在返回 null，其余错误上抛 */
export function readTextFileOrNull(filePath: string): string | null {
  try {
    return readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
