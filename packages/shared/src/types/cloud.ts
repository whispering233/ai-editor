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
 * 自动推送最近一次失败（`cloud.json` book state 的 `lastAutoPushError`）。
 * 自动路径（定时 / 关闭项目 / 手动备份后）失败时写入，**成功即清**；
 * `GET /cloud/status` 的 `local` 段原样透出，面板显示一行，不弹窗、不阻塞请求。
 */
export interface CloudAutoPushError {
  /** 错误码（如 `CLOUD_UNREACHABLE`）；非 HttpError 的意外错误记 `INTERNAL_ERROR` */
  code: string;
  /** 服务端中文文案（直接展示） */
  message: string;
  /** 失败时刻（ISO 8601） */
  at: string;
}

/**
 * `cloud.json` 的 `books` 段（键 = `project.id`）：**本机视角**的书级同步状态。
 * 跨机器不共享（每台机器一份），字段含义见 `docs/design/40-cloud-sync.md` §7：
 * - `dirName`：云端书目录名缓存（改名后由回退扫描按 `-<id>` 后缀重新定位）
 * - `lastPushedFileName`：本机最后一次成功推送的云端文件名（冲突判定基准）
 * - `lastSeenHeadFileName`：本机最后一次看到的云端 head（推送后 / 拉取后更新）
 * - `lastSyncAt`：上次同步成功时刻（ISO 8601）
 * - `baseEntries`：`references/` 与 `sessions/` 的条目名单（拉取并集的三方比较基线）
 * - `lastAutoPushAt` / `lastAutoPushError`：自动推送的节流基准与失败标记（卡 7）
 */
export interface CloudBookSyncState {
  dirName?: string;
  /**
   * **冲突判定基准**：本机最后一次成功**同步**（推送或拉取）到的云端文件名。
   * 推送时写本次推上去的份；拉取时写拉下来的那份（拉取后本机即基于该版本，再推送不应判冲突）。
   */
  lastPushedFileName?: string;
  /** 诊断：上次同步时云端 head 的快照（不参与状态判定——head 会被时钟偏差影响，见设计文档 §3 已知边界） */
  lastSeenHeadFileName?: string;
  /** 上次同步成功时刻（ISO 8601） */
  lastSyncAt?: string;
  /**
   * 上次同步时云端书目录内的**文件集合**（排序）。**「云端有更新」的判定基准**：
   * 集合变化 = 别的机器动过（与时间戳/时钟无关，故比 head 比较更可靠）。
   */
  lastSeenCloudFiles?: string[];
  /** `references/` 与 `sessions/` 的条目名单（拉取并集的三方比较基线；= 最近一次推送/拉取包的条目） */
  baseEntries?: string[];
  /**
   * **自动推送节流基准**（上次自动推送成功时刻，ISO 8601）。
   * **只有定时路径推进**：关闭项目那次不推进（「工作段结束」语义，与 2 小时节流无关）、
   * 手动推送/手动备份后那次也不推进（无条件触发，不占节流额度）——见 `docs/design/40-cloud-sync.md` §5。
   */
  lastAutoPushAt?: string;
  /** 自动路径最近一次失败（成功即清） */
  lastAutoPushError?: CloudAutoPushError;
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
  /** 来源设备（必填：唯一命名格式恒有此段） */
  device: string;
  /** 尾部三段统计（必填：唯一命名格式恒有此段） */
  stats: { characters: number; settings: number; chapters: number };
  size: number;
}

/** 云端侧状态（`GET /cloud/status` 的 `remote` 段；卡 4 起） */
export interface CloudRemoteState {
  /** 云端书目录名（`<书名>-<完整 projectId>`）；云端还没有这个目录 → null */
  dirName: string | null;
  /** 目录内可解析的备份（时间倒序；[0] = head） */
  backups: CloudBackupEntry[];
}

/** `POST /api/v1/cloud/pull` 响应（卡 5） */
export interface CloudPullResult {
  pulled: CloudBackupEntry;
  /** 覆盖前本机自动快照（restore 管道既有行为） */
  snapshot: { fileName: string; createdAt: string };
  /** 两个打包目录的并集结果：kept = 本机独有保留；written = 云端写入；removed = 云端删除而删本机 */
  merged: { kept: number; written: number; removed: number };
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

/** 本机侧同步状态（`GET /cloud/status` 的 `local` 段；卡 5） */
export interface CloudLocalState {
  /** 本机最后一次成功同步（推/拉）到的云端文件名（= 冲突判定基准） */
  lastPushedFileName: string | null;
  lastSyncAt: string | null;
  /** 本机创作数据自上次同步后有改动（三文件 + `data.db-wal` + `references/`/`sessions/`；**不含 `.backups/`**） */
  dirty: boolean;
  /** 最新一份本地备份（推送缺省目标） */
  latestBackupFileName: string | null;
  /** 自动推送最近一次失败（book state 透出；成功即消失，缺省不出现） */
  lastAutoPushError?: CloudAutoPushError;
}

/** 三态状态机（`GET /cloud/status` 的 `state`；判定依据见 `docs/design/40-cloud-sync.md` §3） */
export type CloudSyncState =
  | "unconfigured" // 未配置云盘
  | "no-project" // 未打开项目
  | "unreachable" // 云端检查失败（附 errorCode；本地功能不受影响）
  | "synced" // 已同步（云端无更新 + 本机无改动）
  | "local-ahead" // 本机有未同步改动（可推送）
  | "remote-ahead" // 云端有更新且本机无改动（可拉取）
  | "conflict"; // 两边都有改动（需裁决）

/**
 * `GET /api/v1/cloud/status` 响应（配置段 + `remote` + `local` + `state`，卡 2/4/5 逐步落地）。
 *
 * 判定口径（卡 5 定稿）：
 * - 「云端有更新」= 云端文件集合 ≠ `cloud.json` 里的 `lastSeenCloudFiles`（**不看时间戳**：跨机器时钟偏差会让 head 比较漏报）
 * - 「本机有改动」= 创作数据（三文件 + `data.db-wal` + `references/`/`sessions/` 的 mtime）晚于 `lastSyncAt`
 * - 无同步记录（`lastSyncAt` 缺失）时按「本机有改动」处理（保守：先推/先拉由用户决定）
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
  /** 本机侧状态：未打开项目 → null */
  local: CloudLocalState | null;
  /** 三态状态机（UI 据此决定提示与可用动作） */
  state: CloudSyncState;
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
