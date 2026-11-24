// 写作页「回填本章摘要」的领域口径（章摘要回填闭环 C2）——**消息文案 + 按钮可点性的唯一定义处**。
//
// 契约：`docs/ui/DESIGN.md` `writing-page`「页头『回填本章摘要』」；提案侧工具见 `docs/api/tool-calling.md`
// （`propose_update_outline_node`），字段见 `docs/db/schema.md` / `docs/design/10-data-model.md`（章
// `data.result_summary`，由 C1 提供，本卡不改）。
//
// 链路 = 照练习页「让 AI 点评」的既有姿势（`pages/PracticeDetail.tsx`）：发一条**真实的用户消息**
// + 本次发送的 `focus_node_id`，再聚焦右栏输入框——**不新增端点、不新增通道**，摘要落地仍走 AI 的
// 提案工具（用户确认后才写库）。

/**
 * 触发「回填本章摘要」的**用户可见**消息文案（透明可回溯、不引入隐藏语义）：AI 读本章正文后
 * **提案**更新实际摘要（章 `data.result_summary`），不是直接落库。
 * **唯一定义处**——页头按钮与测试同源，不两处各写一份字面量。
 */
export const CHAPTER_SUMMARY_MESSAGE = "请读本章正文，然后提案更新本章的实际摘要";

/**
 * 能否点「回填本章摘要」（**纯判定**）：正文已落库且非空。
 *
 * 为什么看 `charCount`（服务端「已保存正文」的纯文本字数）而不是编辑器里的内容：AI 读的是库里的
 * 正文（工具面只有只读取数），空章没有可摘的内容，点了只会得到一份空摘要提案。
 * shortcut: 判定只看服务端 `charCount`（`createAutosave` 的待存状态不外露），故有约一个
 * `AUTOSAVE_DELAY_MS` 的滞后：空章刚打第一段、尚未落盘时 `charCount` 仍是 0 → 按钮短暂灰不可点；
 * 反向（清空已保存正文后立即点）则短暂仍可点（AI 读到清空后的正文，得到空摘要提案）。
 * 若要「与库里逐字一致」再判，需把 autosave 的待存状态摊给页面。
 */
export function canRequestChapterSummary(charCount: number): boolean {
  return charCount > 0;
}