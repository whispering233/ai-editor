// 云端存档共享类型（纯类型文件——请求 schema 见 types/api.ts，不含任何运行时代码）
//
// 语义与不变式：`docs/design/40-cloud-sync.md`；端点契约：`docs/api/100-api-cloud.md`。
// 客户端与服务端**共用同一份类型**（不各写一份响应形状）——卡 1 oracle 登记的
// 「备份响应 schema 未收敛到 shared」不在此重演（见 `docs/design/backlog.md`）。

/**
 * `cloud.json` 的 `webdav` 段（`<创作根>/.ai-editor/cloud.json`）。
 * **凭据永不进项目文件**（`project.json` / `outline.json` / `data.db` / `sessions/` / 备份 zip
 * 天然不含），也**永不进任何 API 响应**。
 */
export interface CloudWebdavConfig {
  /** WebDAV 根 URL（含用户自定义前缀），如 `https://dav.jianguoyun.com/dav/ai-editor` */
  url: string;
  username: string;
  /** 应用密码（明文存储 + 文件权限 600；响应侧一律剔除） */
  password: string;
  /** 设备名（备份文件名第 3 段；缺省 = 简化 hostname） */
  device?: string;
}

/**
 * `cloud.json` 的 `books` 段（键 = `project.id`）：**本机视角**的书级同步状态。
 * 跨机器不共享（每台机器一份），字段含义见 `docs/design/40-cloud-sync.md` §7：
 * - `dirName`：云端书目录名缓存（改名后由回退扫描按 `-<id>` 后缀重新定位）
 * - `lastPushedFileName`：本机最后一次成功推送的云端文件名（冲突判定基准）
 * - `lastSeenHeadFileName`：本机最后一次看到的云端 head（推送后 / 拉取后更新）
 * - `lastSyncAt`：上次同步成功时刻（ISO 8601）
 * - `baseEntries`：`references/` 与 `sessions/` 的条目名单（拉取并集的三方比较基线）
 */
export interface CloudBookSyncState {
  dirName?: string;
  lastPushedFileName?: string;
  lastSeenHeadFileName?: string;
  lastSyncAt?: string;
  baseEntries?: string[];
}

/**
 * `cloud.json` 顶层形态（宽松读取：缺失/非法 → 视为未配置）。
 * 未知顶层键在读改写时原样保留（合并写）。
 */
export interface CloudConfigFile {
  webdav?: CloudWebdavConfig;
  /** 自动推送开关（本机级；缺省 false） */
  autoPush?: boolean;
  /** 每本书的同步状态（键 = project.id） */
  books?: Record<string, CloudBookSyncState>;
}

/** 云端一份备份的投影（列表与推送响应用；字段与本地 `BackupEntry` 同名同义） */
export interface CloudBackupEntry {
  fileName: string;
  /** ISO 8601（由文件名时间戳解析，本地时区） */
  createdAt: string;
  kind: "auto" | "manual";
  /** 用户标签（带标签的份**永不参与云端清理**） */
  name?: string;
  device?: string;
  stats?: { characters: number; settings: number; chapters: number };
  size: number;
}

/** 云端侧状态（`GET /cloud/status` 的 `remote` 段；卡 4 起） */
export interface CloudRemoteState {
  /** 云端书目录名（`<书名>-<完整 projectId>`）；云端还没有这个目录 → null */
  dirName: string | null;
  /** 目录内可解析的备份（时间倒序；[0] = head） */
  backups: CloudBackupEntry[];
}

/** `POST /api/v1/cloud/push` 响应（卡 4） */
export interface CloudPushResult {
  pushed: CloudBackupEntry;
  remote: { dirName: string; headFileName: string };
  /** 本次云端清理删除的文件名（带用户标签的份永不列入） */
  pruned: string[];
  /** `force` 且云端原本有 head 时：下载存档进本地 `.backups/` 的那份 */
  snapshot?: { fileName: string };
}

/**
 * `GET /api/v1/cloud/status` 响应。
 *
 * 已落地：配置段（卡 2）+ `remote` 段（卡 4）。
 * `local`（本机已推份 / 未推改动）与 `state`（三态状态机）**属卡 5**——不在本类型里，
 * 避免出现「字段存在但永远为 null」的假契约。
 */
export interface CloudStatus {
  /** webdav 三项（url/username/password）齐备且非空 */
  configured: boolean;
  url: string | null;
  username: string | null;
  /** 生效设备名（配置值；未配置 → 简化 hostname 派生） */
  device: string;
  autoPush: boolean;
  /** 当前打开的项目 id（无项目打开 → null） */
  projectId: string | null;
  /** 云端侧状态：未配置 / 未打开项目 / 云端检查失败 → null */
  remote: CloudRemoteState | null;
  /** 云端检查失败时的错误码（`CLOUD_AUTH_FAILED` / `CLOUD_UNREACHABLE` / `CLOUD_QUOTA_EXCEEDED`）；不阻塞本地功能 */
  errorCode?: string;
}

/** `PUT /api/v1/cloud/config` 响应 */
export interface CloudConfigPutResult {
  saved: true;
}

/** `POST /api/v1/cloud/test` 响应（连通性 + 读/写权限探测） */
export interface CloudTestResult {
  connected: true;
  /** 生效的云端根 URL（规范化后） */
  baseUrl: string;
  /** 本次测试创建了根目录（原先不存在） */
  created: boolean;
}
