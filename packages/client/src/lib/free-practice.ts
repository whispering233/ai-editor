// 自由练习的领域口径（卡 5）——**四态徽标 + 题目空态文案 + 稿件保存动作 + 出题 / 点评触发文案
// + 本篇的新帧判定**的唯一派生入口。
//
// 契约：`docs/api/120-api-practice.md`「自由练习」（列表项 `topic` / `topicSource` / `hasDraft` /
// `hasFeedback`，空串题目 = 待出题；`PUT /practice/free/:id` = 用户写稿唯一入口）、
// `docs/ui/DESIGN.md` §作家文风练习区（列表行四态徽标与「（待出题）」占位；详情页头「待出题」）、
// `docs/design/60-practice.md` §4（两种形态与流程：**不满意 AI 出的题 = 删该篇重建**，不做覆盖式换题）
// 与 §6（卡体两形态同形，差别只在引用校验源与页面标签）。
//
// 与仿写（`lib/practice.ts`）的关系：口径同形、**各自一份实现**（两页的状态集合不同——自由练习多
// 「待出题」一态、少作品分组），故不合并成一个多态入口；但「让 AI 点评」可点性**共用**
// `lib/practice.ts` 的 `canRequestPracticeReview`（逐字相同的谓词只留一份）。

import {
  TOOL_DETAILS_TO_CLIENT,
  type PracticePieceSummary,
} from "@whispering233/ai-editor-shared";
import { ApiError, CLIENT_NETWORK_ERROR, updatePracticePieceDraft } from "./api";

/** 自由练习状态徽标文案（四态；列表行共用同一份文案） */
export type FreePracticeStatus = "待出题" | "待写稿" | "待点评" | "已点评";

/**
 * 题目 / 写作要求的文本口径（**唯一处**）：trim 掉首尾空白；**非字符串 = 未填**。
 * 为什么收这一个守卫：字段直接来自响应体，服务端 shape 漂移（缺字段 / 类型错）时 `.trim()`
 * 会把整页抛成 `TypeError`——视作未填即可降级展示。
 */
export function freePracticeTopicText(topic: unknown): string {
  return typeof topic === "string" ? topic.trim() : "";
}

/**
 * 列表项 → 状态徽标（四态，纯函数）。
 * 先判空题：题目为空 = 这一篇还在等 AI 出题（`topicSource = "ai"` 建的空题行），与有没有稿件无关；
 * 再判卡：有点评卡必然有稿（点评由 AI 读稿产出），故 `hasFeedback` 优先不会掩盖稿件状态。
 * 页面/组件不得各写一份这串分支（同一形状的副本漂移是本仓登记过的缺陷类别）。
 */
export function freePracticeStatus(
  piece: Pick<PracticePieceSummary, "topic" | "hasDraft" | "hasFeedback">,
): FreePracticeStatus {
  if (freePracticeTopicText(piece.topic) === "") return "待出题";
  if (piece.hasFeedback) return "已点评";
  if (piece.hasDraft) return "待点评";
  return "待写稿";
}

/** 空题文案（**唯一字面量**）：列表行用加括号的占位、详情页头用不带括号的「待出题」 */
export const FREE_TOPIC_TEXT = "待出题";

/** 列表行题目文案（去首尾空白；空题 / 非字符串 → 「（待出题）」） */
export function freePracticeTopicLabel(topic: unknown): string {
  const trimmed = freePracticeTopicText(topic);
  return trimmed === "" ? `（${FREE_TOPIC_TEXT}）` : trimmed;
}

/** 详情页头题目文案（去首尾空白；空题 / 非字符串 → 「待出题」，同 `DESIGN.md` §自由练习详情） */
export function freePracticeTopicTitle(topic: unknown): string {
  const trimmed = freePracticeTopicText(topic);
  return trimmed === "" ? FREE_TOPIC_TEXT : trimmed;
}

// ============ 出题 / 点评触发 ============

/**
 * 触发**出题**的**用户可见**消息文案（`60-practice.md` §4 步 1'：出题触发 = 一条真实的用户消息，
 * 透明可回溯、不引入隐藏语义）；**唯一定义处**——两页与测试同源，不两处各写一份字面量。
 */
export const FREE_TOPIC_MESSAGE = "请出一道练习题目";

/** 触发**点评**的用户可见消息文案（`120-api-practice.md`「自由练习点评触发」） */
export const FREE_REVIEW_MESSAGE = "请点评我的自由练习稿";

// 「让 AI 点评」可点性 = `lib/practice.ts` 的 `canRequestPracticeReview`（两形态共用同一谓词）

// ============ 稿件保存 ============

/** 保存失败的形态（页面据此分流：`PRACTICE_NOT_FOUND` → 整页 404 态，其余 → 错误条 + 重试） */
export interface FreeSaveFailure {
  code: string;
  message: string;
}

export interface FreeSaveDeps {
  pieceId: string;
  draft: string;
  /** 写入成功：`updatedAt` = 服务端新版本戳（页面据此前移「已保存稿件」镜像并给「已保存」反馈） */
  onSaved: (updatedAt: string) => void;
  /** 写入失败：码 + 可展示文案（不抛错——失败交回调用方做可见 UI） */
  onFailed: (failure: FreeSaveFailure) => void;
}

/**
 * 提交自由练习稿（页内「保存」按钮与全站 `Ctrl/Cmd+S` 的同一入口）：**返回 `false` = 本次保存失败**。
 *
 * 为什么是布尔而不是抛错：快捷键流程只认两种失败信号——promise 拒绝与 handler 返回 `false`；
 * 页面保存动作都在本地 catch 并给可见 UI ⇒ promise 恒 resolve，**只有这个布尔能把「失败」传回去
 * 阻断存档**（否则失败后照旧生成一份旧内容备份，见 `lib/save-shortcut.ts` 的 `SaveHandler` 契约）。
 * 错误码原样带出（不吞码）——页面按码分流，不在这里决定 UI。
 */
export async function saveFreeDraft(deps: FreeSaveDeps): Promise<boolean> {
  try {
    const res = await updatePracticePieceDraft(deps.pieceId, deps.draft);
    deps.onSaved(res.updatedAt);
    return true;
  } catch (err) {
    deps.onFailed({
      code: err instanceof ApiError ? err.code : CLIENT_NETWORK_ERROR,
      message: err instanceof ApiError ? err.message : "保存失败，请重试",
    });
    return false;
  }
}

// ============ 帧刷新信号（出题与点评共用） ============

/**
 * 工具 `details` 帧归属的自由练习篇 id（取不到 = `null`）。
 * 帧本身只有写库结果（出题 = `{ saved, piece_id }`、点评 = `{ saved, dimension_count, dropped_quotes }`），
 * **没有题目、没有卡体** ⇒ 靠 `tool_execution_start` 帧的入参 `args.piece_id` 认领（聊天 store 把两者
 * 并进同一条记录）。出题（`submit_practice_topic`）与点评（`submit_free_feedback`）**入参都带
 * `piece_id`**（`docs/api/tool-calling.md`）⇒ 详情页两处刷新共用这一份认领口径。
 * 工具名集合取自 shared `TOOL_DETAILS_TO_CLIENT`（哪些工具的 details 会随帧下发，唯一出处），不手抄。
 */
export function freePracticeSignalPieceId(
  frame: { tool: string; args?: unknown } | null,
): string | null {
  if (frame === null) return null;
  if (!(TOOL_DETAILS_TO_CLIENT as readonly string[]).includes(frame.tool)) return null;
  const args = frame.args;
  if (typeof args !== "object" || args === null) return null;
  const pieceId = (args as { piece_id?: unknown }).piece_id;
  return typeof pieceId === "string" ? pieceId : null;
}

/**
 * 是否该为本页篇重拉详情（**纯判定**；页面 effect 只负责「判完就重拉」）：
 * - 无帧 / 旧帧（序号未前进）→ false（同一个帧不得重复触发；页面重挂后 store 里仍有旧帧）
 * - 别的篇的帧 → false（练习帧会推到所有页面，本页只认自己这一篇）
 * 消费序号由调用方持有（页面 ref），本函数不持状态（同 `hooks/use-data-refresh` 的首帧守卫口径）。
 */
export function shouldRefreshFreePiece(args: {
  /** 当前帧序号（无帧 = null） */
  seq: number | null;
  /** 已消费到的帧序号（null = 还没消费过任何帧） */
  seqConsumed: number | null;
  /** 帧归属的篇 id（= `freePracticeSignalPieceId` 的结果） */
  signalPieceId: string | null;
  /** 本页篇 id */
  pieceId: string;
}): boolean {
  if (args.seq === null || args.seq === args.seqConsumed) return false;
  return args.signalPieceId !== null && args.signalPieceId === args.pieceId;
}
