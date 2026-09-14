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
 * `cloud.json` 顶层形态（宽松读取：缺失/非法 → 视为未配置）。
 * 未知顶层键（含 `books` 段——由后续卡片写入）在读改写时原样保留。
 */
export interface CloudConfigFile {
  webdav?: CloudWebdavConfig;
  /** 自动推送开关（本机级；缺省 false） */
  autoPush?: boolean;
}

/**
 * `GET /api/v1/cloud/status` 响应。
 *
 * 卡 2 只填**配置段**；`remote` / `local` / `state` 随后续卡片（推送/拉取）补全——
 * 那三项不在本类型里，避免出现「字段存在但永远为 null」的假契约。
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
