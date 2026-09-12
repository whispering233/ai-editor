// 人物详情双视图纯函数与判据（卡 3.2）
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-workbench`（层级语义/只读语义）与 `tabs`（页内 tab、不进 URL）；
//   `docs/design/10-data-model.md` §14 不变式 2/3：不可变字段不参与 Delta ⇒ 两视图里必然相同；
//   **只有「初始化数据」可编辑**，「当前位置数据」是 `computeState(at_node = current_position)` 的计算结果、只读。
// 本模块只做判据与取值整形——不碰 DOM、不发请求（仓内无 jsdom，纯函数便于单测）。

/** 双视图 tab 键（页内 state；刷新回落默认 tab——DESIGN.md `tabs` 契约） */
export type CharacterViewTab = "initial" | "current";

/**
 * 默认 tab 判据：设置了 `current_position` → 「当前位置数据」；未设置 → 「初始化数据」。
 * 只在用户尚未手动切换时参与（调用方以 `userTab ?? resolveDefaultTab(...)` 合并）。
 */
export function resolveDefaultTab(currentPosition: string | null | undefined): CharacterViewTab {
  return typeof currentPosition === "string" && currentPosition.trim() !== ""
    ? "current"
    : "initial";
}

/**
 * tab 2 计算节点默认值：`current_position` 必须**在大纲树里存在**（失效/软删 → 空串 = 要求手动选择）。
 * 与 `ComputePreview` 同口径——软删节点的计算结果无意义。
 */
export function resolveCurrentAtNode(
  currentPosition: string | null | undefined,
  nodeIds: readonly string[],
): string {
  if (typeof currentPosition !== "string" || currentPosition.trim() === "") return "";
  return nodeIds.includes(currentPosition) ? currentPosition : "";
}

/**
 * 只读取值 → 展示串（tab 2 只读字段视图）：undefined/null → 空串；数组 → 「、」连接
 * （与列表摘要同款展示口径）；其余 `String()` 化。
 */
export function readOnlyFieldValue(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) return raw.map((x) => String(x)).join("、");
  return String(raw);
}
