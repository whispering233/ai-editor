// 人物工作台（master-detail）纯函数与配置（卡 3.1）
// 契约：docs/ui/DESIGN.md §数据展示 `character-workbench`（左栏 = 人物列表本身）
// 本模块只做数据整形/选中推导/排序配置——不碰 DOM、不发请求，便于单测（仓内无 jsdom）。
import { MAX_ENTITY_LIST_LIMIT, type EntitySummary } from "@whispering233/ai-editor-shared";

/** 左栏行模型：姓名 + 角色定位（`summary.role`） */
export interface CharacterRailItem {
  id: string;
  name: string;
  /** 角色定位（自由文本；缺失/非字符串归一为空串——行内不渲染空段） */
  role: string;
}

/** 左栏单次拉取上限（= 列表接口最大 limit；超出走「仅显示前 N 个」提示，不做分页——左栏无分页位置） */
export const RAIL_LIMIT = MAX_ENTITY_LIST_LIMIT;

/**
 * 列表摘要 → 左栏行。
 * 防御性截断 role（长文本撑破 240px 栏；名称由 CSS truncate 处理，role 在此收口）。
 */
export function toRailItems(items: readonly EntitySummary[]): CharacterRailItem[] {
  return items.map((item) => ({
    id: item.id,
    name: item.name,
    role: typeof item.summary.role === "string" ? item.summary.role.trim().slice(0, 30) : "",
  }));
}

/**
 * 「回到列表路由」时的选中推导（`#/characters` 无 id → 需决定选中谁后重定向到 `#/characters/<id>`）：
 * - 列表为空 → null（右栏空态）
 * - 上一次选中**仍在列表里**（用户点左栏导航从详情回到列表）→ 保持它（不做无谓跳转）
 * - 上一次选中**已不在列表里**（刚软删了当前角色）→ 取它在**上一次列表**中的**下一个**；
 *   下一个也已被删/是末尾 → 取上一个；都不可用 → 第一个
 * - 没有上一次选中（首帧直达 / 从别页进入）→ 第一个
 */
export function resolveListRouteSelection(input: {
  items: readonly CharacterRailItem[];
  previousId: string | null;
  previousItems: readonly CharacterRailItem[];
}): string | null {
  const { items, previousId, previousItems } = input;
  if (items.length === 0) return null;
  if (previousId === null) return items[0].id;
  if (items.some((i) => i.id === previousId)) return previousId;
  const prevIndex = previousItems.findIndex((i) => i.id === previousId);
  if (prevIndex === -1) return items[0].id;
  // 先序优先「下一个」，末尾回退「上一个」，都不可用 → 第一个（可能相邻项也已被删）
  const candidates = [previousItems[prevIndex + 1], previousItems[prevIndex - 1]];
  for (const candidate of candidates) {
    if (candidate !== undefined && items.some((i) => i.id === candidate.id)) return candidate.id;
  }
  return items[0].id;
}

/** 左栏排序档（默认 `updated_at` 降序 = 后端列表默认；与列表页 SORT_OPTIONS 同构，额外含 updated_at） */
export interface RailSortOption {
  value: string;
  label: string;
  sort: "updated_at" | "name" | "created_at";
  order: "asc" | "desc";
}

export const RAIL_SORT_OPTIONS: readonly RailSortOption[] = [
  { value: "updated_at:desc", label: "最近更新", sort: "updated_at", order: "desc" },
  { value: "name:asc", label: "名称（A→Z）", sort: "name", order: "asc" },
  { value: "name:desc", label: "名称（Z→A）", sort: "name", order: "desc" },
  { value: "created_at:desc", label: "创建时间（新→旧）", sort: "created_at", order: "desc" },
  { value: "created_at:asc", label: "创建时间（旧→新）", sort: "created_at", order: "asc" },
];

export const RAIL_DEFAULT_SORT = RAIL_SORT_OPTIONS[0].value;

/** 排序档值 → { sort, order }（未知值回落默认档——下拉被清空/脏值时不留 undefined） */
export function resolveRailSort(value: string): {
  sort: RailSortOption["sort"];
  order: "asc" | "desc";
} {
  const option = RAIL_SORT_OPTIONS.find((o) => o.value === value) ?? RAIL_SORT_OPTIONS[0];
  return { sort: option.sort, order: option.order };
}

/** 溢出提示（`total` 超过单次拉取上限时给一行 caption；空串 = 不提示） */
export function railOverflowHint(total: number, loaded: number): string {
  if (total <= loaded || loaded === 0) return "";
  return `共 ${total} 个，仅显示前 ${loaded} 个（用搜索缩小范围）`;
}
