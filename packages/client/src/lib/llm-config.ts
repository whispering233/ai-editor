// LLM 配置（模型 / 思考强度）写入失败的回滚口径——**纯函数**，供 ChatPanel 的配置行调用。
//
// 三条硬约束（来自 DESIGN.md `session-status-bar`「配置写入」）：
// 1. 只写回**本次请求的那个字段**：整份 `setSettings(fresh)` 会盖掉另一字段在途的成功值；
// 2. 回读失败（断网 / 服务未起）时退回**本次写入前的本地快照**，不留一个假的「已切换」值；
// 3. 「该字段是否已有更新的请求」由调用方的请求序号判定（不在这里做——纯函数不知道在途状态）。
import type { SettingsLlmConfig } from "./api";

/** 配置行可写的两个字段 */
export type LlmConfigField = "model" | "thinking";

/**
 * @param field 本次失败的那次写入改的是哪个字段
 * @param current 当前界面上的值（乐观更新后的，保留另一字段）
 * @param source 回滚来源（服务端回读值；回读失败时传写入前的本地快照）
 */
export function rollbackLlmConfig(
  field: LlmConfigField,
  current: SettingsLlmConfig,
  source: SettingsLlmConfig,
): SettingsLlmConfig {
  return field === "model"
    ? { ...current, provider: source.provider, model: source.model }
    : { ...current, thinkingLevel: source.thinkingLevel };
}
