// 云端存档状态层：`<创作根>/.ai-editor/cloud.json` 的**唯一读写入口**
//
// 为什么独立文件（不并入 `config.json`）：见 `docs/design/config.md`「读写边界」——
// 凭据与「用户可手编」的偏好分离，`0600` 只需加给一个文件。
//
// 语义（`docs/design/40-cloud-sync.md` §7）：
// - 文件缺失 / 非法 JSON / 顶层非对象 → 视为「未配置」（不抛错、不阻断启动）
// - 写入 = **合并写**：先读整份，只改本次涉及的键；未知顶层键（含后续卡片的 `books` 段）
//   原样保留——与 `last-project.ts` 的合并写语义一致
// - 权限：创建即 `0600`，且**每次重写都是 0600**（原子写的临时文件也用 0600，rename 保持模式）
// - webdav 段「三项齐备且非空」才算已配置；清除凭据时**保留设备名**（设备不是凭据）
// - 创作根由 `startServer` 注入（`initCloudState`）；未注入（测试/降级）→ 一律视为未配置，
//   写入则报 500（缺创作根属装配错误，不静默吞）
//
// 凭据纪律：password 只在本模块与 webdav 客户端内出现，**永不进任何 API 响应**（路由层负责）。

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { writeJsonAtomic } from "@whispering233/ai-editor-db";
import {
  sanitizeDeviceName,
  type CloudConfigFile,
  type CloudWebdavConfig,
} from "@whispering233/ai-editor-shared";
import { HttpError } from "../middleware/error.js";

/** 配置文件相对创作根的路径（与 `debug.ts` 的 `config.json` 同目录、不同文件） */
const CLOUD_CONFIG_RELATIVE_PATH = join(".ai-editor", "cloud.json");

/** 配置文件权限（含凭据；创建与每次重写都是 0600） */
const CLOUD_CONFIG_FILE_MODE = 0o600;

/** 创作根（`initCloudState` 注入；null = 未初始化） */
let cloudRoot: string | null = null;

/** 注入创作根（`startServer` 启动时调用；null = 未初始化——读取按「未配置」处理） */
export function initCloudState(root: string | null): void {
  cloudRoot = root;
}

/** 配置文件绝对路径（未初始化 → null） */
export function cloudConfigPath(): string | null {
  return cloudRoot === null ? null : join(cloudRoot, CLOUD_CONFIG_RELATIVE_PATH);
}

/**
 * 读取整份配置（**宽松读取**，未知键原样保留在返回值里）：
 * 无创作根 / 文件不存在 / 读取失败 / 非法 JSON / 顶层非对象 → null（调用方按「未配置」处理）。
 */
export function readCloudFile(): CloudConfigFile | null {
  const path = cloudConfigPath();
  if (path === null) return null;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return typeof parsed === "object" && parsed !== null ? (parsed as CloudConfigFile) : null;
  } catch {
    return null;
  }
}

/**
 * `webdav` 段（**三项齐备且非空**才算已配置，否则 null）：
 * url / username 去首尾空白后非空、password 非空串；`device` 可选（空串视为未配置设备名）。
 */
export function readWebdavConfig(): CloudWebdavConfig | null {
  const raw = readCloudFile()?.webdav;
  if (typeof raw !== "object" || raw === null) return null;
  const { url, username, password, device } = raw as Partial<CloudWebdavConfig>;
  if (typeof url !== "string" || url.trim() === "") return null;
  if (typeof username !== "string" || username.trim() === "") return null;
  if (typeof password !== "string" || password === "") return null;
  return {
    url: url.trim(),
    username: username.trim(),
    password,
    ...(typeof device === "string" && device.trim() !== "" ? { device: device.trim() } : {}),
  };
}

/** 自动推送开关（缺省 false；非布尔按 false——读侧宽松） */
export function readAutoPush(): boolean {
  return readCloudFile()?.autoPush === true;
}

/**
 * 配置的设备名：只有通过 `sanitizeDeviceName` 才认（非法/缺失 → null → 上层回缺省 hostname）。
 * 校验在此处收敛，写入侧（路由）也走同一函数。
 */
export function configuredDeviceName(): string | null {
  const device = readCloudFile()?.webdav?.device;
  if (typeof device !== "string") return null;
  return sanitizeDeviceName(device);
}

/**
 * 写入补丁：`undefined` = 不修改该项；`null` = 清除该项（url/username/password/device）。
 * `autoPush` 只接受布尔（`undefined` = 不修改）。
 */
export interface CloudConfigPatch {
  url?: string | null;
  username?: string | null;
  password?: string | null;
  device?: string | null;
  autoPush?: boolean;
}

/**
 * 合并写配置（原子写 + 0600）：
 * - webdav 三项齐空 → 删除 `webdav` 段；但**设备名非空时保留**（设备不是凭据，仍作用于备份文件名）
 * - `autoPush` 与 `books` 段在每次写入后保持显式存在/原样保留
 *
 * @throws HttpError 500 创作根未初始化（装配错误）；I/O 错误向上抛（路由 → 500）
 */
export function writeCloudConfig(patch: CloudConfigPatch): void {
  const path = cloudConfigPath();
  if (path === null) {
    throw new HttpError(500, "INTERNAL_ERROR", "创作根未初始化（startServer 未调用 initCloudState）");
  }
  const current = (readCloudFile() ?? {}) as CloudConfigFile & Record<string, unknown>;
  const currentWebdav = (typeof current.webdav === "object" && current.webdav !== null
    ? current.webdav
    : {}) as Partial<CloudWebdavConfig>;

  /** `undefined` = 保留原值；`null` = 清空；字符串 = 覆盖 */
  const pick = (next: string | null | undefined, prev: string | undefined): string =>
    next === undefined ? (prev ?? "") : (next ?? "");

  const url = pick(patch.url, currentWebdav.url);
  const username = pick(patch.username, currentWebdav.username);
  const password = pick(patch.password, currentWebdav.password);
  const device = patch.device === undefined ? currentWebdav.device : (patch.device ?? undefined);
  const hasDevice = typeof device === "string" && device !== "";

  const next: Record<string, unknown> = { ...current };
  if (url === "" && username === "" && password === "") {
 // 未配置态：删掉凭据段（保留设备名——它仍参与备份文件名）
    if (hasDevice) next.webdav = { url: "", username: "", password: "", device };
    else delete next.webdav;
  } else {
    next.webdav = { url, username, password, ...(hasDevice ? { device } : {}) };
  }
  next.autoPush = patch.autoPush ?? current.autoPush === true;

  mkdirSync(dirname(path), { recursive: true });
  writeJsonAtomic(path, next, { mode: CLOUD_CONFIG_FILE_MODE });
}
