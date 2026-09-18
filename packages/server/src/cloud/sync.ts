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

import { existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Unzip } from "fflate";
import {
  parseBackupFileName,
  type CloudBackupEntry,
  type CloudLocalState,
  type CloudPullResult,
  type CloudPushResult,
  type CloudSyncState,
} from "@whispering233/ai-editor-shared";
import { HttpError } from "../middleware/error.js";
import type { ProjectContext } from "../middleware/project.js";
import { BACKUPS_DIR_NAME, PACKED_DIR_NAMES, hasLocalEditsSince, hasUnbackedChanges, restoreBackup } from "../backup.js";
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
      device: parsed.device,
      stats: parsed.stats,
      size: entry.size ?? 0,
    });
  }
  // 时间倒序（最新在前；head = [0]）——与本地备份列表同口径
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** zip 内随包目录（`sessions/`）的条目名（`baseEntries` 基线；**只读名字不碰数据**，零解压开销） */
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
  const id = project.config.id;
  if (typeof cachedDirName === "string" && cachedDirName !== "" && (await client.list(cachedDirName)) !== null) {
    return cachedDirName;
  }
  const root = await client.list("");
  // 匹配三种命名（都含完整 id）：`<书名>-<id>`（默认）、`ai-editor-<id>`（名字被拒后的回退）、
  // `<id>`（回退链最后一档，某些云盘对名字长度限制极严时用）
  const match = (root ?? []).find(
    (entry) => entry.isCollection && (entry.name === id || entry.name.endsWith(`-${id}`)),
  );
  return match?.name ?? null;
}

/** 推送用：已存在则用它，否则回落到预期名（由 `MKCOL` 创建） */
/**
 * 幂等建书目录；**名字被云盘拒绝时回退短名**（坚果云实测：`<书名>-<id>` 可能触发
 * `400 IllegalArgument / sandbox name is too long`，其单段名字限制比文档里的 255 字符路径上限严得多）。
 *
 * 回退名务必**仍以 `-<id>` 结尾**——`findExistingCloudDir` 的回退扫描就是按这个后缀找目录的；
 * 长度 = `ai-editor-` (10) + `-` + id（26）≈ 37 字符纯 ASCII，比任意中文书名短且稳定。
 *
 * @returns 实际生效的目录名（正常 = 传入名；回退 = 短名）
 */
export async function ensureBookDir(
  client: WebdavClient,
  dirName: string,
  project: ProjectContext,
): Promise<string> {
  // 候选链：漂亮名 → 短前缀名 → 纯 id（后者一定最短，且仍被回退扫描匹配）
  const candidates = [dirName, `ai-editor-${project.config.id}`, project.config.id].filter(
    (name, i, all) => all.indexOf(name) === i,
  );
  let lastErr: unknown;
  for (const name of candidates) {
    try {
      await client.mkcol(name);
      if (name !== dirName) {
        console.warn(`[cloud] 云盘拒绝较长的目录名，改用「${name}」（原候选「${dirName}」）`);
      }
      return name;
    } catch (err) {
      lastErr = err;
      // 只在「名字不被接受」这类 4xx 上换名字重试；网络/认证/配额等照旧抛。
      // 注意用 `upstreamStatus`（上游原始码）——对外的 `status` 一律是映射后的 502。
      const upstream = err instanceof HttpError ? err.upstreamStatus : undefined;
      if (upstream === undefined || upstream < 400 || upstream >= 500) throw err;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("云盘拒绝创建书目录（名字长度限制？）");
}

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

/** 云端书目录内的**文件集合**（排序；目录条目剔除）——「云端有更新」的判定基准（与时间戳无关） */
export function cloudFileSet(entries: readonly DavEntry[]): string[] {
  return entries
    .filter((entry) => !entry.isCollection)
    .map((entry) => entry.name)
    .sort();
}

/** `GET /cloud/status` 的本机段 + 三态（UI 据此决定提示与可用动作） */
export interface CloudSyncComputation {
  local: CloudLocalState | null;
  state: CloudSyncState;
}

/**
 * 计算本机侧状态与三态（卡 5 定稿口径）：
 * - **「云端有更新」= 云端文件集合 ≠ `lastSeenCloudFiles`**（不看时间戳：跨机器时钟偏差会让 head 比较漏报，见设计文档 §3）
 * - **「本机有改动」= 创作数据 mtime 晚于 `lastSyncAt`**（`hasLocalEditsSince`，三文件 + `data.db-wal` +
 *   `sessions/`；**不含 `.backups/`**——force 会把云端旧份写进那里）。
 *   注意口径差异：`data.db`/`-wal` 比较带 1s 容差（checkpoint 会刷新其 mtime），其余**严格比较**
 * - 自动推送的失败标记（`lastAutoPushError`）原样透出（面板显示一行，成功即消失；卡 7）
 * - 无同步记录（`lastSyncAt`/`lastSeenCloudFiles` 缺失）→ 云端有份即视为「有更新」、本机按「有改动」处理（保守）
 */
export function computeCloudSync(
  project: ProjectContext | null,
  webdavConfigured: boolean,
  remote: { files: readonly string[] } | null,
): CloudSyncComputation {
  if (project === null) {
    return { local: null, state: webdavConfigured ? "no-project" : "unconfigured" };
  }
  const state = readBookState(project.config.id);
  const lastSyncAt = state?.lastSyncAt ?? null;
  const dirty = lastSyncAt === null ? true : hasLocalEditsSince(project, new Date(lastSyncAt));
  const local: CloudLocalState = {
    lastPushedFileName: state?.lastPushedFileName ?? null,
    lastSyncAt,
    dirty,
    latestBackupFileName: latestLocalBackupName(join(project.root, BACKUPS_DIR_NAME)),
    // 「有改动未进最新备份」**且**「确有未同步改动」：后者把「管道自己刚写下的文件」排掉——
    // 拉取/恢复会用刚生成的快照（时间戳早于写入）当最新备份，若只看 mtime 会立刻误报「有改动未进备份」
    //（用户实测）。自动路径的守卫用的是**纯** `hasUnbackedChanges`（那边必须严格：最新备份确实落后于本机状态
    // 就不能推，否则会把旧内容推上去），两者口径不同是有意的。
    backupStale: hasUnbackedChanges(project) && dirty,
    // 自动推送最近一次失败（缺省不出现——成功即清，见 cloud/auto-push.ts）
    ...(state?.lastAutoPushError !== undefined ? { lastAutoPushError: state.lastAutoPushError } : {}),
  };
  if (!webdavConfigured) return { local, state: "unconfigured" };
  if (remote === null) return { local, state: "unreachable" };
  const seen = state?.lastSeenCloudFiles;
  const remoteChanged =
    seen === undefined ? remote.files.length > 0 : seen.join("\n") !== [...remote.files].sort().join("\n");
  if (remoteChanged && dirty) return { local, state: "conflict" };
  if (remoteChanged) return { local, state: "remote-ahead" };
  if (dirty) return { local, state: "local-ahead" };
  return { local, state: "synced" };
}

export interface PullOptions {
  /** 要拉取的云端备份文件名（缺省 = 云端 head）；须通过 parseBackupFileName 白名单 */
  fileName?: string;
}

/**
 * 从云端拉取一份备份应用到当前项目（`POST /cloud/pull` 的实现）。
 *
 * 流程：定位书目录 → 列目录取目标（缺省 head）→ 下载 → 原样落进本地 `.backups/`（校验失败则回收）→
 * 走 **restore 管道**（覆盖前自动快照 + 校验 + 原子替换三文件 + db 重连 + 重启备份定时器）+
 * **随包目录（`sessions/`）并集合并**（基线 = `cloud.json` 的 `baseEntries`，删除优先）→ 更新同步状态
 *（`lastPushedFileName` = 拉到的这份，既是新的冲突判定基准，也是「本机已基于该版本」的标记；
 * `lastSeenCloudFiles` = 当前云端集合 → 立刻复查不会判「云端有更新」）。
 *
 * @throws HttpError 409 CLOUD_NOT_CONFIGURED、404 CLOUD_FILE_NOT_FOUND、400 VALIDATION_ERROR（坏包/文件名非法）、
 *   409 SCHEMA_VERSION_MISMATCH（备份来自更高版本）、502 三码
 */
export async function pullBackup(project: ProjectContext, options: PullOptions = {}): Promise<CloudPullResult> {
  const webdav = readWebdavConfig();
  if (webdav === null) {
    throw new HttpError(409, "CLOUD_NOT_CONFIGURED", "云盘未配置：请先在设置页填写 WebDAV 地址与用户名/应用密码");
  }
  if (options.fileName !== undefined && parseBackupFileName(options.fileName) === null) {
    throw new HttpError(400, "VALIDATION_ERROR", `备份文件名不在白名单内: ${options.fileName}`);
  }
  const projectId = project.config.id;
  const client = createWebdavClient(webdav);
  const stateBefore = readBookState(projectId);
  const dirName = await findExistingCloudDir(client, project, stateBefore?.dirName);
  const entries = dirName === null ? [] : ((await client.list(dirName)) ?? []);
  const backups = toCloudBackups(entries);
  const head = backups[0] ?? null;
  const target =
    options.fileName === undefined ? head : (backups.find((entry) => entry.fileName === options.fileName) ?? null);
  if (target === null || dirName === null) {
    throw new HttpError(
      404,
      "CLOUD_FILE_NOT_FOUND",
      options.fileName === undefined
        ? "云端还没有可拉取的备份（先在本机推送一份）"
        : `云端那份备份已不存在: ${options.fileName}（可能已被保留策略清理或手动删除）`,
    );
  }

  const bytes = await client.get(`${dirName}/${target.fileName}`);
  if (bytes === null) {
    throw new HttpError(404, "CLOUD_FILE_NOT_FOUND", `云端那份备份已不存在: ${target.fileName}`);
  }

  // 原样落进本地 .backups/（成为一份普通本地备份，参与保留策略；校验失败则回收，不留坏包）
  const backupsDir = join(project.root, BACKUPS_DIR_NAME);
  mkdirSync(backupsDir, { recursive: true });
  const localPath = join(backupsDir, target.fileName);
  const createdLocally = !existsSync(localPath);
  if (createdLocally) writeFileSync(localPath, bytes);

  let restored: ReturnType<typeof restoreBackup>;
  try {
    // 走 restore 管道（覆盖前自动快照 / 校验 / 原子替换 / 重连 / 定时器），但两目录用并集合并
    restored = restoreBackup(project, target.fileName, {
      mergePackedDirs: { baseEntries: stateBefore?.baseEntries ?? [] },
    });
  } catch (err) {
    if (createdLocally) {
      try {
        unlinkSync(localPath); // 坏包/版本不兼容：不留一份无法使用的“备份”
      } catch {
        // 回收失败不掩盖原始错误
      }
    }
    throw err;
  }

  writeBookState(projectId, {
    dirName,
    lastPushedFileName: target.fileName,
    lastSeenHeadFileName: head.fileName,
    lastSyncAt: new Date().toISOString(),
    lastSeenCloudFiles: cloudFileSet(entries),
    baseEntries: packedEntriesOfZip(bytes),
  });

  return {
    pulled: target,
    snapshot: restored.snapshot,
    merged: restored.merged ?? { kept: 0, written: 0, removed: 0 },
  };
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
  const resolved = await resolveBookDirName(client, project, stateBefore?.dirName);
  let dirName = resolved;
  let entries = await client.list(dirName);
  if (entries === null) {
    // 工作区可能还不存在（从未跑过「测试连接」）——幂等建「云盘根 + 工作根」，
    // 否则 MKCOL 书目录会因父目录缺失报 409（被映射成「云盘不可达」，文案误导；见 backlog）
    if ((await client.list("")) === null) await client.ensureWorkingRoot();
    // 名字过长被拒时回退短名（坚果云实测），回退结果就是这次真正使用的目录名
    dirName = await ensureBookDir(client, dirName, project);
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
  // 已存在同名同大小的份 → **跳过上传**（用户连点、上次推完又推、自动推送重试）：既省云盘配额，
  // 也避开「目标已存在」在部分云盘上的 MOVE 语义差异（坚果云即使带 `Overwrite: T` 也回 409 DuplicateName）
  const alreadyThere = entries.some((entry) => !entry.isCollection && entry.name === local.fileName && entry.size === local.size);
  if (!alreadyThere) {
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
  }

  // ⑥ 保留清理（只在推送成功后；失败不阻塞——pruneCloudBackups 内部吞错记日志）
  // 注意：状态里的 lastSeenCloudFiles 必须记**清理后**的集合（否则下次检查会把被清理的份当成变化）
  const pruned = await pruneCloudBackups(client, dirName, await client.list(dirName).then((list) => list ?? []));
  const after = (await client.list(dirName)) ?? [];

  // ⑦ 更新本机同步状态（推送成功后；baseEntries = zip 内 `sessions/` 的条目名，供拉取三方比较）
  // `lastAutoPushError` 的**唯一清除点**在这里（`undefined` 在合并写下即删除该键）：口径是
  // 「最近一次自动推送失败」——任何一次推送成功都证明它已过期，不能只由自动路径清
  //（否则用户手动推送成功后，面板仍常驻一行过期的失败提示；见卡 7 oracle 反例 4）
  writeBookState(projectId, {
    dirName,
    lastPushedFileName: local.fileName,
    lastSeenHeadFileName: toCloudBackups(after)[0]?.fileName ?? local.fileName,
    lastSyncAt: new Date().toISOString(),
    lastSeenCloudFiles: cloudFileSet(after),
    baseEntries: packedEntriesOfZip(local.bytes),
    lastAutoPushError: undefined,
  });

  const parsedLocal = parseBackupFileName(local.fileName) as NonNullable<ReturnType<typeof parseBackupFileName>>;
  const pushed: CloudBackupEntry = {
    fileName: local.fileName,
    createdAt: parsedLocal.time.toISOString(),
    kind: parsedLocal.kind,
    ...(parsedLocal.name !== undefined ? { name: parsedLocal.name } : {}),
    device: parsedLocal.device,
    stats: parsedLocal.stats,
    size: local.size,
  };
  return {
    pushed,
    remote: { dirName, headFileName: local.fileName },
    pruned,
    ...(snapshot !== undefined ? { snapshot } : {}),
  };
}
