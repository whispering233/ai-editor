// 能力面板（character.data.ability_panel）纯函数库（卡片 2.5）
//
// 职责：结构防御解析 / 顶层分组名 / 叶子路径枚举 / 模板派生深拷贝 / 值类型判定。
// 契约：docs/db/schema.md「人物 data 分层」（结构不变式）、docs/design/10-data-model.md §14
//（结构人工编辑、只有已存在叶子可被 Delta 改、模板派生 = 结构快照深拷贝）。
//
// 消费方：db 列表摘要与统计（2.1/2.2）、变更记录的叶子字段路径、人物页 panel-tree（批次 3）、
// 面板模板与「从角色复制」（结构快照）。
//
// 宽校验契约：**任何非法结构都不得抛错**——读取端按「空面板 / 跳过坏元素」处理，
// 坏 JSON 不能打挂 computeState 或列表接口（同 custom_fields 的宽松先例）。
// **读端自动规范化（幂等）**：`panelLeafPaths` / `panelTopLevelNames` / `cloneAbilityPanel`
// 接受 `unknown`（raw JSON 可直接传入）并在内部先过 `parseAbilityPanel`——消费方不得假定
// `data.ability_panel` 是规范形状（见 docs/db/schema.md「人物 data 分层」宽校验段）。
//
// 路径解析口径（docs/db/schema.md「面板路径解析口径」）：点分路径的**数组段按同层 `name` 匹配、
// 取先序第一个**；名字含 `.` 或同层重名属**已知歧义**（解析侧不拒绝，UI 结构编辑给防呆提示）；
// 路径前缀由 `abilityPanelFieldPath` 统一拼接，消费方禁止手拼。

import type { AbilityPanelLeaf, AbilityPanelNode } from "../types/ability-panel.js";

/** 叶子值域（与 DeltaChange 的 from/to/value 同域） */
type AbilityPanelValue = string | number;

/** 面板在 character.data 中的键名（**唯一拼写**；字段路径拼接必须走 `abilityPanelFieldPath`） */
export const ABILITY_PANEL_DATA_KEY = "ability_panel";

/**
 * Delta 字段路径拼接：`ability_panel.<叶子点分路径>`（如 `ability_panel.火系.等级`）。
 *
 * 接受 `panelLeafPaths` 的产物（叶子对象）或其 `path` 字符串——**消费方不得手拼 `ability_panel.` 前缀**
 * （前缀拼写漂移会让 Delta 路径静默失效，见 docs/db/schema.md「面板路径解析口径」）。
 */
export function abilityPanelFieldPath(pathOrLeaf: string | AbilityPanelLeaf): string {
  const path = typeof pathOrLeaf === "string" ? pathOrLeaf : pathOrLeaf.path;
  return `${ABILITY_PANEL_DATA_KEY}.${path}`;
}

/** 数值字面量：整数/小数 + 可选负号（不支持指数、千分位、前导 +） */
const ABILITY_NUMBER_PATTERN = /^-?\d+(?:\.\d+)?$/;

/**
 * 判定分支节点（`children` 为**非空数组**）——**分支/叶子的唯一拼写**，
 * UI 与工具不得各自内联 `node.children?.length` 判断（不变式：分支 ⇔ 非空 children 数组）。
 *
 * 防御：先做 `Array.isArray`——宽校验 JSON 里 `children` 可能是字符串/对象
 *（`{ children:"s" }` 在只比 `length > 0` 时会误判为分支）。
 */
export function isAbilityBranch(node: AbilityPanelNode): boolean {
  return Array.isArray(node.children) && node.children.length > 0;
}

/**
 * 防御解析能力面板：任意 JSON 值 → **规范形状**节点数组。
 *
 * 口径：
 * - 非数组输入（null/对象/字符串/number）→ `[]`（空面板）
 * - 坏元素**跳过**、保留其余合法元素：非对象、数组元素、`name` 非字符串或空/纯空白
 * - `children` 非数组、或为空数组 → **归一为叶子**（与「删掉最后一个子节点即降级为叶子」一致）
 * - 分支节点上的 `value` **丢弃**（分支不可赋值）；叶子 `value` 仅接受 `string` / 有限 `number`
 *   （`null` / `NaN` / `Infinity` → 视为缺省）
 * - 未知键丢弃（返回规范形状）；**不修改入参**（不改写 `name` 原文——仅用于空名校验时为只读）
 */
export function parseAbilityPanel(value: unknown): AbilityPanelNode[] {
  if (!Array.isArray(value)) return [];
  return parseAbilityNodes(value);
}

/**
 * 叶子枚举（**先序遍历序**；供变更记录字段下拉与 Delta 字段路径使用）。
 *
 * `path` = 祖先名与自身名逐字以 `.` 拼接（如 `火系.等级`）、**不做转义**——
 * 名字本身含 `.` 时路径有歧义（`a.b` 既可能是 `a` → `b`，也可能是单节点名 `a.b`）；
 * 已知边界：面板 UI 侧对含 `.` 的名字给防呆提示，解析侧不拒绝（宽校验）。
 *
 * **输入可 raw**（自动过 `parseAbilityPanel`）——直接传 `entity.data.ability_panel` 安全。
 */
export function panelLeafPaths(panel: unknown): AbilityPanelLeaf[] {
  const out: AbilityPanelLeaf[] = [];
  collectLeaves(parseAbilityPanel(panel), "", out);
  return out;
}

/**
 * 顶层分组名（顺序 = 数组顺序；**不去重**——消费者按需去重/计数，见 2.2 统计口径）。
 * **输入可 raw**（自动过 `parseAbilityPanel`）。
 */
export function panelTopLevelNames(panel: unknown): string[] {
  return parseAbilityPanel(panel).map((node) => node.name);
}

/**
 * 结构快照深拷贝（面板模板 / 从已有角色复制结构）。
 *
 * 返回**规范形状副本**：不共享任何引用（数组与嵌套对象全部新建）、丢弃分支上的 `value`、
 * 空 `children` 数组归一为叶子（与 `parseAbilityPanel` 同口径）；叶子 `value` 原样保留
 * （模板里的值 = 派生后的默认值，见 `10-data-model.md` §14 不变式 6）。
 * **输入可 raw**（自动过 `parseAbilityPanel`）——非规范输入先规范化再拷贝。
 */
export function cloneAbilityPanel(panel: unknown): AbilityPanelNode[] {
  return parseAbilityPanel(panel).map(cloneAbilityNode);
}

/**
 * UI 值输入 → 存储值：
 * - `trim` 后为空串/纯空白 → `undefined`（空值，叶子允许）
 * - 纯数字字面量 → `number`（`"12"` → 12）；超出双精度可表示范围（非有限数）→ 退回 `string`
 * - 其余非空文本 → `string`（原样去首尾空白）
 *
 * 已知瑕疵：`"007"` 存为 `7`（丢前导零——数值语义）；需保留前导零时写非纯数字文本（如 `"007级"`）。
 */
export function coerceAbilityValue(raw: string): AbilityPanelValue | undefined {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  if (!ABILITY_NUMBER_PATTERN.test(trimmed)) return trimmed;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : trimmed;
}

/** 递归收集叶子（`prefix` = 祖先名点分前缀；顶层传空串） */
function collectLeaves(
  nodes: readonly AbilityPanelNode[],
  prefix: string,
  out: AbilityPanelLeaf[],
): void {
  for (const node of nodes) {
    const path = prefix === "" ? node.name : `${prefix}.${node.name}`;
    if (isAbilityBranch(node)) {
      collectLeaves(node.children ?? [], path, out);
      continue;
    }
    out.push(node.value === undefined ? { path, name: node.name } : { path, name: node.name, value: node.value });
  }
}

/** 单节点深拷贝（分支丢弃 value、空 children 归一为叶子——规范形状） */
function cloneAbilityNode(node: AbilityPanelNode): AbilityPanelNode {
  const children = node.children;
  if (Array.isArray(children) && children.length > 0) {
    return { name: node.name, children: cloneAbilityPanel(children) };
  }
  return node.value === undefined ? { name: node.name } : { name: node.name, value: node.value };
}

/** 单节点防御解析（坏元素 → null 由调用方跳过） */
function parseAbilityNode(raw: unknown): AbilityPanelNode | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const name = record.name;
  if (typeof name !== "string" || name.trim() === "") return null; // 空名/纯空白名 → 节点无意义

  const children = Array.isArray(record.children) ? parseAbilityNodes(record.children) : [];
  if (children.length > 0) return { name, children }; // 分支：丢弃 value（不可赋值）

  const value = normalizeAbilityValue(record.value);
  return value === undefined ? { name } : { name, value };
}

/** 节点数组防御解析（跳过坏元素） */
function parseAbilityNodes(raw: readonly unknown[]): AbilityPanelNode[] {
  const out: AbilityPanelNode[] = [];
  for (const item of raw) {
    const node = parseAbilityNode(item);
    if (node !== null) out.push(node);
  }
  return out;
}

/** 叶子值归一：仅接受 `string` / 有限 `number`；其余（null/NaN/Infinity/对象/布尔）→ 缺省 */
function normalizeAbilityValue(raw: unknown): AbilityPanelValue | undefined {
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  return undefined;
}
