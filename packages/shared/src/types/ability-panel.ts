// 能力面板（character.data.ability_panel）数据类型
// 结构契约见 docs/db/schema.md「人物 data 分层」；解析/枚举/派生纯函数见 utils/ability-panel.ts。
//
// 不变式（单一来源，调用方不得各写一套拼写）：
// - **分支 ⇔ `children` 为非空数组**：有 children = 分支（**不可赋值**）；无 children = 叶子（**可赋值**）
// - 叶子 `value` ∈ `string | number`（与 DeltaChange 的 from/to/value 同域）；缺省 = 空值
// - 顺序 = 数组顺序（**无 sort_order 列、无迁移**）；嵌套层数不限

/** 能力面板节点（分支 = 带非空 `children`；叶子 = 带可选 `value`） */
export interface AbilityPanelNode {
  name: string;
 /** 叶子值（仅叶子出现——分支不可赋值，规范形状下分支不携带该键） */
  value?: string | number;
 /** 子节点（非空数组 = 分支；缺省 = 叶子） */
  children?: AbilityPanelNode[];
}

/** 叶子枚举项（panelLeafPaths 返回值）：`path` = 祖先名点分拼接，供 Delta 字段路径使用 */
export interface AbilityPanelLeaf {
 /** 点分路径（如 `火系.等级`）——逐字拼接不做转义 */
  path: string;
  name: string;
  value?: string | number;
}
