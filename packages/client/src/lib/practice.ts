// 文风仿写练习的展示口径（卡 9）——**样本状态徽标三态的唯一派生入口**。
//
// 契约：`docs/api/120-api-practice.md`「GET /practice/targets/:id/samples」的样本列表项字段
// （`hasDraft` / `hasFeedback`，列表不回正文与卡体）、`docs/ui/DESIGN.md` §文风练习区
// （样本行 `type-badge` 文案 =「未写稿」/「待点评」/「已点评」）。
//
// 优先级（先判卡再加稿）：有点评卡必然有稿（点评由 AI 读稿产出，见 `60-practice.md` §2），
// 故 `hasFeedback` 优先不会掩盖稿件状态；页面/组件不得各写一份 `hasFeedback ? … : hasDraft ? …`
// （同一形状三次复发是仓库登记过的类别——值改了、别的副本没改）。

import type { PracticeSampleItem } from "@whispering233/ai-editor-shared";

/** 样本状态徽标文案（三态；列表行与将来的详情页共用同一份文案） */
export type PracticeSampleStatus = "未写稿" | "待点评" | "已点评";

/**
 * 样本列表项 → 状态徽标文案（三态，见文件头优先级说明）。
 * 入参只需两个布尔位（列表项与详情页都能给出），不绑死整个响应对象。
 */
export function practiceSampleStatus(
  sample: Pick<PracticeSampleItem, "hasDraft" | "hasFeedback">,
): PracticeSampleStatus {
  if (sample.hasFeedback) return "已点评";
  if (sample.hasDraft) return "待点评";
  return "未写稿";
}

/**
 * 目标「我的观察」的可展示文本：`null` / 空串 / 纯空白 → `null`（调用点据此**不渲染该行**）。
 * REST schema 只把空串归一成 `null`（`docs/api/120-api-practice.md` 的 PUT 语义），
 * 纯空白仍会落库 ⇒ 展示侧的取舍收在这里，页面不重复判断。
 */
export function practiceObservationText(observation: string | null): string | null {
  if (observation === null) return null;
  const trimmed = observation.trim();
  return trimmed === "" ? null : trimmed;
}
