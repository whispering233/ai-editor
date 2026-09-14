// 云端推送（卡 4）：把一份本地备份上传到云盘书目录
//
// 语义（`docs/design/40-cloud-sync.md` §3 整包 + 乐观并发 / §6 云端布局、保留、临时名 + MOVE）与
// 端点契约（`docs/api/100-api-cloud.md` 的 `POST /cloud/push`）逐条对应。不变式：
// - **推送 = 上传本地备份文件本身**（逐字节拷贝、文件名原样），不重新打包、不转换格式
// - 云端正式文件名下**永远是完整包**（`PUT` 临时名 → `MOVE` 提交；中断只留 `.tmp-` 垃圾，下次推送前清理）
// - **冲突判定 = 云端 head ≠ 本机 `lastPushedFileName`**（不看文件是否存在——旧份被清理也不误判）
// - 保留策略：只删「能解析出时间戳」的份、**带用户标签的永不删**；只在推送成功后执行，失败不阻塞
// - 云端书目录按 `project.id` 定位（缓存 `dirName` 快路径 → 404 回退扫描根目录按 `-<id>` 后缀匹配）
// - 推送前本地体积检查（云盘单文件上限），不等服务器回 413

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Unzip } from "fflate";
import { parseBackupFileName, type CloudBackupEntry, type CloudPushResult } from "@whispering233/ai-editor-shared";
import { HttpError } from "../middleware/error.js";
import type { ProjectContext } from "../middleware/project.js";
import { BACKUPS_DIR_NAME, PACKED_DIR_NAMES } from "../backup.js";
import { readBookState, readWebdavConfig, writeBookState } from "./state.js";
import { createWebdavClient, type DavEntry, type WebdavClient } from "./webdav.js";

/** 云盘单文件上限（实测口径：坚果云 WebDAV 500MB，见设计文档 §2 限制表） */
export const MAX_CLOUD_FILE_BYTES = 500 * 1024 * 1024;

/** 云端保留份数（**不带标签**的份；带标签的永不清理） */
export const MAX_CLOUD_BACKUPS = 5;

/** 上传中/中断遗留的临时文件名前缀（正式名与保留策略都不认它们；推送前清理） */
export const CLOUD_TMP_PREFIX = ".tmp-";

/** 推送结果 = shared `CloudPushResult`（响应形状单一来源；client 读同一份类型） */
export type PushResult = CloudPushResult;

export interface PushOptions {
  /** 要推送的本地备份文件名（缺省 = 最新一份）；须通过 parseBackupFileName 白名单 */
  fileName?: string;
  /** true = 云端 head ≠ lastPushed 时「用本机强推」（先把云端那份下载存进本地 .backups/） */
  force?: boolean;
}

/** 本地 `.backups/` 下最新一份（按文件名时间戳；无合法备份 → null） */
function latestLocalBackupName(backupsDir: string): string | null {
  let files: string[];
  try {
    files = readdirSync(backupsDir);
  } catch {
    return null;
  }
  let latest: { name: string; time: number } | null = null;
  for (const file of files) {
    const parsed = parseBackupFileName(file);
    if (parsed === null) continue;
    const time = parsed.time.getTime();
    if (latest === null || time > latest.time) latest = { name: file, time };
  }
  return latest?.name ?? null;
}

/** 解析并读取待推送的本地备份（白名单校验防路径穿越；缺文件 404） */
function resolveLocalBackup(
  project: ProjectContext,
  fileName?: string,
): { fileName: string; bytes: Uint8Array; size: number } {
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  const name = fileName ?? latestLocalBackupName(backupsDir);
  if (name === null) {
    throw new HttpError(404, "VALIDATION_ERROR", "本机没有可推送的备份（先「立即备份」生成一份）");
  }
  if (parseBackupFileName(name) === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份文件名不在白名单内: ${name}`);
  }
  const path = join(backupsDir, name);
  if (!existsSync(path)) {
    throw new HttpError(404, "VALIDATION_ERROR", `备份不存在: ${name}`);
  }
  const bytes = readFileSync(path);
  return { fileName: name, bytes, size: bytes.length };
}

/** 云端条目 → 备份投影（只认能解析出时间戳的文件；目录与非本程序命名的文件跳过） */
export function toCloudBackups(entries: readonly DavEntry[]): CloudBackupEntry[] {
  const out: CloudBackupEntry[] = [];
  for (const entry of entries) {
    if (entry.isCollection) continue;
    const parsed = parseBackupFileName(entry.name);
    if (parsed === null) continue;
    out.push({
      fileName: entry.name,
      createdAt: parsed.time.toISOString(),
      kind: parsed.kind,
      ...(parsed.name !== undefined ? { name: parsed.name } : {}),
      ...(parsed.device !== undefined ? { device: parsed.device } : {}),
      ...(parsed.stats !== undefined ? { stats: parsed.stats } : {}),
      size: entry.size ?? 0,
    });
  }
  // 时间倒序（最新在前；head = [0]）——与本地备份列表同口径
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** zip 内两个打包目录的条目名（`baseEntries` 基线；**只读名字不碰数据**，零解压开销） */
export function packedEntriesOfZip(zip: Uint8Array): string[] {
  const names: string[] = [];
  const unzipper = new Unzip((file) => {
    names.push(file.name); // 不 start()：只收名，不做任何解压
  });
  unzipper.push(zip, true);
  return names.filter((name) => PACKED_DIR_NAMES.some((dir) => name.startsWith(`${dir}/`))).sort();
}

/**
 * 定位云端书目录名：
 * ① 缓存 `dirName` 且目录存在 → 用它；
 * ② 否则回退扫描云盘根目录，取名字以 `-<projectId>` 结尾的集合（改名后仍能认出来）；
 * ③ 都没有 → 用预期名 `<书名>-<完整 id>`（后续 `MKCOL` 创建；旧目录留存不影响正确性）。
 */
export async function findExistingCloudDir(
  client: WebdavClient,
  project: ProjectContext,
  cachedDirName?: string,
): Promise<string | null> {
  const suffix = `-${project.config.id}`;
  if (typeof cachedDirName === "string" && cachedDirName !== "" && (await client.list(cachedDirName)) !== null) {
    return cachedDirName;
  }
  const root = await client.list("");
  const match = (root ?? []).find((entry) => entry.isCollection && entry.name.endsWith(suffix));
  return match?.name ?? null;
}

/** 推送用：已存在则用它，否则回落到预期名（由 `MKCOL` 创建） */
export async function resolveBookDirName(
  client: WebdavClient,
  project: ProjectContext,
  cachedDirName?: string,
): Promise<string> {
  return (
    (await findExistingCloudDir(client, project, cachedDirName)) ?? `${project.config.name}-${project.config.id}`
  );
}

/** 云端 head = 能解析出时间戳的备份里时间最新的一份（目录内没有合法备份 → null） */
function headOf(backups: readonly CloudBackupEntry[]): CloudBackupEntry | null {
  return backups.length === 0 ? null : (backups[0] as CloudBackupEntry);
}

/**
 * 清理书目录里遗留的 `.tmp-*`（我们自己的前缀；可能来自中断的上传）。
 * 只删前缀匹配的**文件**；失败仅记日志（垃圾清理不该阻塞推送）。
 */
export async function cleanCloudTempFiles(client: WebdavClient, dirName: string, entries: readonly DavEntry[]): Promise<void> {
  for (const entry of entries) {
    if (entry.isCollection || !entry.name.startsWith(CLOUD_TMP_PREFIX)) continue;
    try {
      await client.remove(`${dirName}/${entry.name}`);
    } catch (err) {
      console.error(`[cloud] 清理云端临时文件失败（跳过）: ${entry.name}`, err);
    }
  }
}

/**
 * 保留策略：把「能解析出时间戳且**没有用户标签**」的份按时间倒序保留最近 `MAX_CLOUD_BACKUPS` 份，
 * 其余删除（带标签的份、目录、非本程序命名的文件一律不动）。返回本次删除的文件名。
 */
export async function pruneCloudBackups(
  client: WebdavClient,
  dirName: string,
  entries: readonly DavEntry[],
): Promise<string[]> {
  const deletable = entries
    .filter((entry) => !entry.isCollection)
    .map((entry) => ({ entry, parsed: parseBackupFileName(entry.name) }))
    .filter((x): x is { entry: DavEntry; parsed: NonNullable<ReturnType<typeof parseBackupFileName>> } => x.parsed !== null)
    .filter((x) => x.parsed.name === undefined) // 带标签的永不清理
    .sort((a, b) => b.parsed.time.getTime() - a.parsed.time.getTime());
  const pruned: string[] = [];
  for (const { entry } of deletable.slice(MAX_CLOUD_BACKUPS)) {
    try {
      await client.remove(`${dirName}/${entry.name}`);
      pruned.push(entry.name);
    } catch (err) {
      console.error(`[cloud] 清理云端旧备份失败（不阻塞推送）: ${entry.name}`, err);
    }
  }
  return pruned;
}

/** 把云端 head 原样下载存进本地 `.backups/`（强推前的「两边都留档」；本地已有同名则保留本地那份） */
function archiveCloudHead(project: ProjectContext, fileName: string, bytes: Uint8Array): { fileName: string } {
  const path = join(project.root, BACKUPS_DIR_NAME, fileName);
  if (!existsSync(path)) writeFileSync(path, bytes);
  return { fileName };
}

/**
 * 书名改名后同步云端目录名（WebDAV `MOVE`，卡 4）。
 *
 * 调用方（`POST /project/rename`）**不阻塞本地改名**：云端慢/不可达时改名照常成功，失败只记日志——
 * 下一轮推送/状态检查会按 `-<projectId>` 后缀回退扫描重新定位（只是云端目录名暂时落后）。
 * 云端还没有这本书的目录（从未推送过）→ 直接返回，不创建。
 */
export async function renameCloudDir(project: ProjectContext): Promise<void> {
  const webdav = readWebdavConfig();
  if (webdav === null) return;
  const client = createWebdavClient(webdav);
  const state = readBookState(project.config.id);
  const current = await findExistingCloudDir(client, project, state?.dirName);
  if (current === null) return;
  const next = `${project.config.name}-${project.config.id}`;
  if (current === next) return;
  await client.move(current, next);
  writeBookState(project.config.id, { dirName: next });
}

/**
 * 推送一份本地备份到云端（`POST /cloud/push` 的实现）。
 *
 * @throws HttpError 409 CLOUD_NOT_CONFIGURED / CLOUD_CONFLICT、400 VALIDATION_ERROR / CLOUD_BACKUP_TOO_LARGE、
 *   404 VALIDATION_ERROR（本地备份不存在）、502 CLOUD_AUTH_FAILED / CLOUD_UNREACHABLE / CLOUD_QUOTA_EXCEEDED
 */
export async function pushBackup(project: ProjectContext, options: PushOptions = {}): Promise<PushResult> {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先在设置页填写 WebDAV 地址与用户名/应用密码");
  }
  const local = resolveLocalBackup(project, options.fileName);
  const projectId = project.config.id;
  const client = createWebdavClient(webdav);

  // ① 定位云端书目录（缓存 → 回退扫描 → 预期名）；目录不存在 → 幂等 MKCOL
  const stateBefore = readBookState(projectId);
  const dirName = await resolveBookDirName(client, project, stateBefore?.dirName);
  let entries = await client.list(dirName);
  if (entries === null) {
    await client.mkcol(dirName);
    entries = (await client.list(dirName)) ?? [];
  }

  // ② 清理遗留临时文件后重新列目录（残留来自中断的上传）；冲突判定基于 head
  await cleanCloudTempFiles(client, dirName, entries);
  entries = (await client.list(dirName)) ?? [];
  const backups = toCloudBackups(entries);
  const head = headOf(backups);
  const lastPushed = stateBefore?.lastPushedFileName;
  const conflicted = head !== null && head.fileName !== lastPushed;

  // ③ 冲突：默认拒绝（人裁决在 UI）；force = 先把云端那份存进本地 .backups/（两边都留档）
  let snapshot: { fileName: string } | undefined;
  if (conflicted && options.force === true) {
    const bytes = await client.get(`${dirName}/${head.fileName}`);
    if (bytes !== null) snapshot = archiveCloudHead(project, head.fileName, bytes);
  } else if (conflicted) {
    throw new HttpError(
      409,
      "CLOUD_CONFLICT",
      `云端已有更新的备份（${head.fileName}），本机上次推送的是 ${lastPushed ?? "（无记录）"}——请先拉取查看，或选择用本机覆盖云端`,
    );
  }

  // ④ 体积检查（本地判定，不等服务器回 413）
  if (local.size > MAX_CLOUD_FILE_BYTES) {
    throw new HttpError(
      400,
      "CLOUD_BACKUP_TOO_LARGE",
      `备份包 ${(local.size / 1024 / 1024).toFixed(1)}MB 超过云盘单文件上限 ${MAX_CLOUD_FILE_BYTES / 1024 / 1024}MB，未推送`,
    );
  }

  // ⑤ 上传：临时名 → MOVE（正式名下永远是完整包；MOVE 失败清理临时名后抛出）
  const tmpName = `${CLOUD_TMP_PREFIX}${local.fileName}`;
  await client.put(`${dirName}/${tmpName}`, local.bytes);
  try {
    await client.move(`${dirName}/${tmpName}`, `${dirName}/${local.fileName}`);
  } catch (err) {
    try {
      await client.remove(`${dirName}/${tmpName}`);
    } catch {
      // 临时名残留由下次推送前清理；原始错误优先
    }
    throw err;
  }

  // ⑥ 更新本机同步状态（推送成功后；baseEntries = zip 内两个打包目录的条目名，供拉取三方比较）
  writeBookState(projectId, {
    dirName,
    lastPushedFileName: local.fileName,
    lastSeenHeadFileName: local.fileName,
    lastSyncAt: new Date().toISOString(),
    baseEntries: packedEntriesOfZip(local.bytes),
  });

  // ⑦ 保留清理（只在推送成功后；失败不阻塞——pruneCloudBackups 内部吞错记日志）
  const pruned = await pruneCloudBackups(client, dirName, await client.list(dirName).then((list) => list ?? []));

  const parsedLocal = parseBackupFileName(local.fileName) as NonNullable<ReturnType<typeof parseBackupFileName>>;
  const pushed: CloudBackupEntry = {
    fileName: local.fileName,
    createdAt: parsedLocal.time.toISOString(),
    kind: parsedLocal.kind,
    ...(parsedLocal.name !== undefined ? { name: parsedLocal.name } : {}),
    ...(parsedLocal.device !== undefined ? { device: parsedLocal.device } : {}),
    ...(parsedLocal.stats !== undefined ? { stats: parsedLocal.stats } : {}),
    size: local.size,
  };
  return {
    pushed,
    remote: { dirName, headFileName: local.fileName },
    pruned,
    ...(snapshot !== undefined ? { snapshot } : {}),
  };
}
