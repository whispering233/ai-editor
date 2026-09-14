// 自动推送（卡 7）：三条触发路径共用「该不该推」的判断与「失败怎么记」的口径
//
// 语义（`docs/design/40-cloud-sync.md` §5 触发口径）与不变式：
// - **自动推送不是无条件的**（不变式 10）：定时路径必须同时满足「2 小时节流」与「创作数据有变更」；
//   关闭项目（「工作段结束」语义）与手动备份成功后各无条件推一次，且**不受节流**、**不推进节流基准**
// - 变更判定分两档：定时路径只看**创作数据**（`hasAuthoringChangesSince`——排除 `sessions/`，聊天
//   不改创作数据，不该单烧一次配额）；关闭项目路径看**任何变更**（含 `sessions/`）
// - **失败一律不抛、不阻塞**：只写 `lastAutoPushError` + `console.error`（关闭项目那次尤其如此——
//   网络差时一次 push 可能数秒，不能拖住关闭；`POST /project/close` / `/project/backup` 都是 fire-and-forget）
// - **职责分离（卡 B）**：云端**永不创建备份**；定时与关闭项目路径在「有改动未进最新备份」
//   （`hasUnbackedChanges`）时**跳过**——不推旧包、也不写 `lastAutoPushError`（不是失败，是还没有
//   能代表当下的档）；手动备份后的路径不受此限（刚生成的份必然最新）。用户主动同步时的二选一见
//   `cloud-stale-backup-dialog`（客户端）。
// - **本机没有任何备份 → 跳过而非失败**：用户还没「立即备份」过，不写错误标记（不是出问题，是没东西可推）
// - 定时路径不推进 `lastAutoPushAt` 之外的任何状态——推送成功后的 `lastSyncAt`/`lastPushedFileName`
//   由 `pushBackup` 写入（与手动推送同一套）
//
// 依赖方向：本模块 → backup / cloud(state, sync)；**不得反向**（backup 模块不 import cloud，
// tick 钩子由 middleware/project.ts 注册，见 backup.ts 的 `setProjectTick`）。

import { hasAuthoringChangesSince, hasLocalEditsSince, hasUnbackedChanges } from "../backup.js";
import { HttpError } from "../middleware/error.js";
import type { ProjectContext } from "../middleware/project.js";
import { readAutoPush, readBookState, readWebdavConfig, writeBookState, type CloudBookState } from "./state.js";
import { pushBackup } from "./sync.js";

/**
 * 自动推送节流窗口（2 小时，**写死常量**）：免费云盘上传流量有限（坚果云 1GB/月），而创作数据的
 * 变更频率远高于此。与 SSE 心跳间隔、提案 TTL 同类——失控保护类数值不给用户配（见设计文档 §5）。
 */
export const AUTO_PUSH_THROTTLE_MS = 2 * 60 * 60 * 1000;

export interface AutoPushOptions {
  /** 节流窗口（缺省 `AUTO_PUSH_THROTTLE_MS`；测试注入小值） */
  throttleMs?: number;
  /** 当前时刻（缺省 `Date.now`；测试注入假时钟） */
  now?: () => number;
}

/** 自动推送的开关条件：云盘未配置（凭据被清空）或 `autoPush` 关 → 三个入口一律直接返回 */
function autoPushOff(): boolean {
  return readWebdavConfig() === null || !readAutoPush();
}

/** 状态写入的容错包装：写失败（如创作根未初始化）不得让自动路径抛错打断调用方 */
function safeWriteBookState(projectId: string, patch: CloudBookState): void {
  try {
    writeBookState(projectId, patch);
  } catch (err) {
    console.error("[cloud] 自动推送状态写入失败（忽略，下次重试）:", err);
  }
}

/** 记一次自动推送失败：日志 + book state 的 `lastAutoPushError`（面板显示一行，不弹窗） */
function recordFailure(project: ProjectContext, err: unknown, atMillis: number): void {
  const code = err instanceof HttpError ? err.code : "INTERNAL_ERROR";
  const message = err instanceof Error ? err.message : String(err);
  console.error(`[cloud] 自动推送失败（只记状态，不阻塞）: ${code} ${message}`);
  safeWriteBookState(project.config.id, {
    lastAutoPushError: { code, message, at: new Date(atMillis).toISOString() },
  });
}

/**
 * 推一次（三条路径共用）——推的内容 = **最新一份本地备份**（手动备份后调用时即刚生成的那份）。
 *
 * - 成功：`writeThrottle` 时把 `lastAutoPushAt` 推进到本次时刻（`lastAutoPushError` 由 `pushBackup` 成功后清）
 * - 本机没有任何备份（`pushBackup` 404）：**跳过**——自动路径从不传 `fileName`，故 404 只可能
 *   是「没有可推送的备份」（另一个 404 分支要求显式 `fileName`），不推进节流、不写错误标记
 * - 其他失败：`recordFailure`（不抛）
 *
 * @returns 本次是否真的推了
 */
async function pushOnce(
  project: ProjectContext,
  options: { writeThrottle: boolean; atMillis: number },
): Promise<boolean> {
  try {
    await pushBackup(project);
  } catch (err) {
    if (err instanceof HttpError && err.status === 404) return false;
    recordFailure(project, err, options.atMillis);
    return false;
  }
  safeWriteBookState(project.config.id, {
    // 只推进节流基准；失败标记的清除是 `pushBackup` 成功写的单点职责（见 sync.ts ⑦ 注释）
    ...(options.writeThrottle ? { lastAutoPushAt: new Date(options.atMillis).toISOString() } : {}),
  });
  return true;
}

/**
 * 定时路径（挂在自动备份 tick 链上，卡 7 单一定时器）：
 * 条件 = 「已配置云盘且 `autoPush` 开启」∧「距 `lastAutoPushAt` ≥ 节流」∧「创作数据（不含 `sessions/`）
 * 自 `lastSyncAt` 后有变更」；基线 `lastSyncAt` 缺失（从未同步过）→ 按「有变更」处理（保守）。
 *
 * **本函数永不 reject**：tick 用 `void maybeAutoPush(project)` 调用（未捕获的 rejection 会打断进程），
 * 一切失败只进 `lastAutoPushError` + 日志。
 *
 * @returns 本次是否真的推了（节流中 / 无变更 / 无备份 / 失败 → false）
 */
export async function maybeAutoPush(project: ProjectContext, options: AutoPushOptions = {}): Promise<boolean> {
  if (autoPushOff()) return false;
  const now = options.now ?? Date.now;
  const throttleMs = options.throttleMs ?? AUTO_PUSH_THROTTLE_MS;
  const state = readBookState(project.config.id);

  // ① 节流（先判，省一次 mtime 遍历）：lastAutoPushAt 缺失/不可解析 = 未推过 → 放行
  const lastAutoPushAt = state?.lastAutoPushAt;
  if (typeof lastAutoPushAt === "string") {
    const last = Date.parse(lastAutoPushAt);
    if (!Number.isNaN(last) && now() - last < throttleMs) return false;
  }

  // ② 有改动未进最新备份（卡 B）→ **跳过不推**，也不记失败：这不是失败，是「还没有能代表当下的档」。
  //    云端永不创建备份（职责分离）——等下次备份 tick（频率开启时）自然补上，或用户主动同步时二选一。
  if (hasUnbackedChanges(project)) return false;

  // ③ 变更（只看创作数据；`sessions/` 的改动由关闭项目那次带走）
  const lastSyncAt = state?.lastSyncAt;
  const changed =
    typeof lastSyncAt !== "string" ||
    Number.isNaN(Date.parse(lastSyncAt)) ||
    hasAuthoringChangesSince(project, new Date(lastSyncAt));
  if (!changed) return false;

  return pushOnce(project, { writeThrottle: true, atMillis: now() });
}

/**
 * 关闭项目路径（`POST /project/close`，调用方 fire-and-forget）：
 * 「工作段结束」语义——**不受节流**、变更判定含 `sessions/`（有任何变更就推），
 * 且**不推进 `lastAutoPushAt`**（与 2 小时节流无关）。失败只记状态 + 日志。
 *
 * 调用时机：`setCurrentProject(null)` 之前启动即可——推送只读 `.backups/` 与 `cloud.json`，
 * 不碰 data.db 连接，故关闭顺序不影响正确性。
 */
export async function autoPushOnClose(project: ProjectContext): Promise<void> {
  if (autoPushOff()) return;
  // 卡 B：有改动未进最新备份 → 跳过（同定时路径；免得把落后内容静默推上去让另一台误以为已同步）
  if (hasUnbackedChanges(project)) return;
  const lastSyncAt = readBookState(project.config.id)?.lastSyncAt;
  const changed =
    typeof lastSyncAt !== "string" ||
    Number.isNaN(Date.parse(lastSyncAt)) ||
    hasLocalEditsSince(project, new Date(lastSyncAt));
  if (!changed) return;
  await pushOnce(project, { writeThrottle: false, atMillis: Date.now() });
}

/**
 * 手动备份成功后（`POST /project/backup`，调用方 fire-and-forget）：
 * **无条件推一次且不受节流**（用户刚明确要求备份 = 值得让云端也有这份），
 * 推的内容 = 最新一份 = 刚生成的那份；**不推进 `lastAutoPushAt`**（手动路径不占节流额度）。失败同上。
 */
export async function autoPushAfterManualBackup(project: ProjectContext): Promise<void> {
  if (autoPushOff()) return;
  await pushOnce(project, { writeThrottle: false, atMillis: Date.now() });
}
