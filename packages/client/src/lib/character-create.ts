// 新建人物弹窗纯函数与判据（卡片 3.5）
//
// 契约：`docs/design/tasks.md` 卡 3.5（必填 = 姓名/角色定位/描述，**仅前端**校验；其余可选；
//   面板三选 = 空白 / 内置模板 / 从已有角色复制；重名软提示不阻断；提交后自动选中）；
//   `docs/ui/DESIGN.md` §数据展示 `character-workbench`（左栏行头「+ 新建」/ 空态主操作）；
//   `docs/db/schema.md`「人物 data 分层」（`description` 必填=仅前端；面板结构与宽校验）；
//   `docs/design/10-data-model.md` §14 不变式 6（模板派生 = **结构快照深拷贝**，模板叶子 `value` 作为默认值）。
//
// 本模块只做判据与载荷整形——不碰 DOM、不发请求（仓内无 jsdom，纯函数便于单测）。

import { cloneAbilityPanel, type AbilityPanelNode } from "@whispering233/ai-editor-shared";
import {
  CHARACTER_BASICS_DATA_KEYS,
  CHARACTER_MUTABLE_DATA_KEYS,
  validateCharacterBasics,
} from "./character-detail";
import { PANEL_TEMPLATES } from "./panel-tree";

/** 必填三项的判据结果（`null` = 无错） */
export interface CharacterCreateErrors {
  name: string | null;
  role: string | null;
  description: string | null;
}

/**
 * 必填判据（**仅前端**——服务端不硬校验，保护提案/旧数据/备份导入三条路径，见 `docs/db/schema.md`）：
 * 姓名 / 角色定位 / 描述 `trim` 后非空。
 * 姓名与描述复用详情页 `validateCharacterBasics`（同源文案）；**角色定位为本弹窗追加**——
 * 详情页允许空角色定位（既有数据可能为空），创建入口要求填写（卡 3.5 规格），两者口径有意不同。
 */
export function validateCharacterCreate(input: {
  name: unknown;
  role: unknown;
  description: unknown;
}): CharacterCreateErrors {
  const basics = validateCharacterBasics({ name: input.name, description: input.description });
  const role = typeof input.role === "string" ? input.role.trim() : "";
  return {
    name: basics.name,
    role: role === "" ? "角色定位不能为空" : null,
    description: basics.description,
  };
}

/** 必填判据是否有错（提交拦截用） */
export function hasCharacterCreateErrors(errors: CharacterCreateErrors): boolean {
  return errors.name !== null || errors.role !== null || errors.description !== null;
}

/** 重名归一化口径：`trim` + 小写（英文名大小写不敏感；中文等价于仅 `trim`） */
export function normalizeCharacterName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * 重名判据（**软提示，不阻断提交**）：命中 → 返回既有条目的原文姓名，未命中/空名 → `null`。
 * 候选集来自 `GET /entity/character`（该端点默认过滤软删 → **已软删的同名角色不提示**）。
 */
export function findDuplicateCharacterName(
  items: readonly { name: string }[],
  name: string,
): string | null {
  const target = normalizeCharacterName(name);
  if (target === "") return null;
  const hit = items.find((item) => normalizeCharacterName(item.name) === target);
  return hit?.name ?? null;
}

/**
 * 表单值裁剪（只写入非空值——`data` 是 `Record` 稀疏语义：未填字段不产生键）：
 * - 字符串：`trim` 后空串丢弃；写入的是 trim 后的值
 * - 数字：非有限值丢弃（`0` 保留）
 * - 数组：逐项 `trim`、过滤空串，全空则丢弃
 * - 其余（对象/布尔等）：原样保留（本弹窗不产生，防御）
 */
export function pruneCharacterFormValues(
  values: Record<string, unknown>,
  keys: readonly string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) {
    const value = values[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed !== "") out[key] = trimmed;
      continue;
    }
    if (typeof value === "number") {
      if (Number.isFinite(value)) out[key] = value;
      continue;
    }
    if (Array.isArray(value)) {
      const list = value
        .filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "")
        .map((entry) => entry.trim());
      if (list.length > 0) out[key] = list;
      continue;
    }
    out[key] = value;
  }
  return out;
}

/**
 * 创建载荷（`POST /entity/character`）：姓名走 `entities.name` 列，其余走 `data`；
 * 能力面板**非空时**深拷贝写入（空面板 = 不写该键——与「空白面板」选项一致）。
 */
export function buildCharacterCreatePayload(input: {
  name: string;
  basics: Record<string, unknown>;
  mutable: Record<string, unknown>;
  panel: readonly AbilityPanelNode[];
}): { name: string; data: Record<string, unknown> } {
  const data: Record<string, unknown> = {
    ...pruneCharacterFormValues(input.basics, CHARACTER_BASICS_DATA_KEYS),
    ...pruneCharacterFormValues(input.mutable, CHARACTER_MUTABLE_DATA_KEYS),
  };
  if (input.panel.length > 0) data.ability_panel = cloneAbilityPanel(input.panel);
  return { name: input.name.trim(), data };
}

/** 面板来源模式（三选：空白 / 内置模板 / 从已有角色复制） */
export type PanelChoiceMode = "blank" | "template" | "copy";
/** 面板来源选择（`templateId` / `sourceId` 仅在对应模式下有意义） */
export interface PanelChoice {
  mode: PanelChoiceMode;
  templateId: string;
  sourceId: string;
}

/** 面板来源模式下拉项（DESIGN：三选；顺序 = 从简到繁） */
export const PANEL_MODE_OPTIONS: readonly { value: PanelChoiceMode; label: string }[] = [
  { value: "blank", label: "空白面板" },
  { value: "template", label: "内置模板" },
  { value: "copy", label: "从已有角色复制" },
];

/** 默认面板来源 = 空白（用户不选也能直接创建） */
export const DEFAULT_PANEL_CHOICE: PanelChoice = { mode: "blank", templateId: "", sourceId: "" };

/** 候选角色单次拉取上限（重名判据 + 「从角色复制」共用一份；与左栏/面板树同档 200，
 * 超出部分既不参与重名提示、也不出现在复制候选——已知边界，同 `RAIL_LIMIT`） */
export const CHARACTER_CANDIDATE_LIMIT = 200;

/** 模板 → 面板结构（**深拷贝快照**：模板叶子 `value` 作为派生后的默认值；未知 id → 空面板） */
export function panelFromTemplate(templateId: string): AbilityPanelNode[] {
  const template = PANEL_TEMPLATES.find((item) => item.id === templateId);
  return template === undefined ? [] : cloneAbilityPanel(template.panel);
}

/** 源角色 `data` → 面板结构（**深拷贝**；缺失/脏结构由 `cloneAbilityPanel` 归一为空面板） */
export function panelFromCharacterData(
  data: Record<string, unknown> | null | undefined,
): AbilityPanelNode[] {
  return cloneAbilityPanel(data?.ability_panel);
}

/** 面板节点总数（含分支与叶子；界面提示「将创建 N 个字段」用） */
export function panelNodeCount(panel: readonly AbilityPanelNode[]): number {
  let count = 0;
  const walk = (nodes: readonly AbilityPanelNode[]): void => {
    for (const node of nodes) {
      count += 1;
      if (Array.isArray(node.children)) walk(node.children);
    }
  };
  walk(panel);
  return count;
}
