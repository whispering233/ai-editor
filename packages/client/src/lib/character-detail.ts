// 人物详情纯函数与判据（卡 3.2；卡 3.3 补：必填判据、tab 判据三态；卡 3.3 修复轮：对象值只读渲染 /
// 描述为空提示 / 大纲加载文案单一来源；卡 6.2 改：删可变性分区标题、立详情页字段顺序单一清单）
// 契约：`docs/ui/DESIGN.md` §数据展示 `character-workbench`（四 tab / 档案式字段网格 / 只读纯文本值）与
//   `tabs`（页内 tab、不进 URL）；
//   `docs/design/10-data-model.md` §14：不变式 1（不可变字段不参与 Delta，人工可编辑）、
//   不变式 2（两视图里不可变字段必然相同）、不变式 3（**只有「人物档案」可编辑**）；
//   `docs/db/schema.md`「人物 data 分层」（字段归属）与 `description` 必填（**仅前端校验**）。
// 本模块只做判据与取值整形——不碰 DOM、不发请求（仓内无 jsdom，纯函数便于单测）。

import { IMMUTABLE_FIELDS } from "@whispering233/ai-editor-shared";
import { detailFieldsForType, type DetailFieldConfig } from "./entity-detail";

/** 页内 tab 键（四 tab：人物档案 / 阅读进度 / 人物关系网 / 其他关联；刷新回落默认 tab——DESIGN.md `tabs` 契约） */
export type CharacterViewTab = "initial" | "current" | "relations" | "other";

/** 分区标题已删（卡 6.2）：UI 不再按可变性分块——分层只服务变更记录白名单与 AI 提案边界 */

/**
 * 不可变字段（不参与 Delta；人工**仍可编辑**——`name` 是 `entities.name` 列、不在 data 字段清单里，
 * 由档案网格单独渲染，故不在此列表）。
 * **白名单单一事实源 = shared `IMMUTABLE_FIELDS.character`**（卡片 5.6：tools 提案层守卫与
 * `lib/delta-create` 字段下拉排除消费同一常量）。
 * **用途收窄（卡 6.2）**：仅服务新建弹窗分段与创建载荷 prune；详情页按 `CHARACTER_DETAIL_FIELD_KEYS` 渲染。
 */
export const CHARACTER_BASICS_DATA_KEYS: readonly string[] = IMMUTABLE_FIELDS.character;

/** 可变字段键（参与 Delta；能力面板 `ability_panel` 结构特殊，由 `panel-tree` 单独渲染）——用途同上 */
export const CHARACTER_MUTABLE_DATA_KEYS = [
  "alias",
  "gender",
  "age",
  "race",
  "motivation",
  "personality",
] as const;

/**
 * 详情页字段渲染顺序（**单一清单**）：档案式阅读顺序 = 身份（角色定位）→ 短字段（假名/性别/年龄/种族）
 * → 长篇（描述/性格/动机）。可变性分层**不进 UI**（两 tab 共用本顺序，label 逐一致才好对比）。
 */
export const CHARACTER_DETAIL_FIELD_KEYS: readonly string[] = [
  "role",
  "alias",
  "gender",
  "age",
  "race",
  "description",
  "personality",
  "motivation",
];

/**
 * 按 key 取字段配置（缺失 → 抛错：配置漂移应在测试里立刻暴露，不静默丢字段）。
 * label/control 单一来源仍 = `detailFieldsForType("character")`。
 */
export function characterFieldsByKeys(keys: readonly string[]): DetailFieldConfig[] {
  const all = detailFieldsForType("character");
  return keys.map((key) => {
    const field = all.find((f) => f.key === key);
    if (field === undefined) throw new Error(`人物字段配置缺失: ${key}`);
    return field;
  });
}

/** 详情页字段（顺序 = `CHARACTER_DETAIL_FIELD_KEYS`） */
export function characterDetailFields(): DetailFieldConfig[] {
  return characterFieldsByKeys(CHARACTER_DETAIL_FIELD_KEYS);
}

/** 单行字段判据（`text`/`number` → 档案网格单元；`textarea`/`tags` → 整行铺满） */
export function isSingleLineField(field: DetailFieldConfig): boolean {
  return field.control === "text" || field.control === "number";
}

/** 必填判据结果（`name` / `description` 两个错误位各自独立；`null` = 无错） */
export interface CharacterBasicsErrors {
  name: string | null;
  description: string | null;
}

/**
 * 必填判据（**仅前端**，服务端不硬校验——见 `docs/db/schema.md`）：`trim` 后非空即通过。
 * `name` 一并校验：姓名入力在档案网格首位（`entities.name`），空名会被服务端 400 拦下，
 * 这里提前拦截以避免无效往返。
 */
export function validateCharacterBasics(input: {
  name: unknown;
  description: unknown;
}): CharacterBasicsErrors {
  const name = typeof input.name === "string" ? input.name.trim() : "";
  const description = typeof input.description === "string" ? input.description.trim() : "";
  return {
    name: name === "" ? "姓名不能为空" : null,
    description: description === "" ? "描述不能为空" : null,
  };
}

/** 基础信息判据是否有错（提交拦截用） */
export function hasCharacterBasicsErrors(errors: CharacterBasicsErrors): boolean {
  return errors.name !== null || errors.description !== null;
}

/**
 * 字段值判空（`trim` 口径，与 `validateCharacterBasics` 同源）：非字符串（undefined/null/数字）一律视为空。
 * 供「描述为空」提示与调用方自建提示复用，避免两处各自写判据。
 */
export function isEmptyTextField(raw: unknown): boolean {
  return typeof raw !== "string" || raw.trim() === "";
}

/**
 * 「描述为空」提示文案（档案网格「描述」字段下方，**仅可编辑态且值为空**时展示）。
 * 存在意义：`description` 是硬必填 ⇒ 历史空值角色在补齐前**保存不了任何修改**，
 * 不给提示时会表现为「保存按钮无效」，用户无从得知原因。
 */
export const DESCRIPTION_EMPTY_HINT = "描述为空，保存前需填写";

/**
 * 大纲在途加载文案（**单一来源**）：进度节点选择器与阅读进度 tab 的位置提示共用同一常量，
 * 避免出现「新旧两套」加载文案；大纲未到位时阅读进度 tab 展示的是初始 `data` 而非位置累积结果，
 * 提示必须随之出现（否则暂时"看似已算完"）。
 */
export const OUTLINE_LOADING_TEXT = "大纲加载中…";

/** tab 判据结果（默认 tab + 阅读进度四态；两者同源，不得各自推导） */
export interface CharacterTabState {
  /** 默认 tab（用户在未手动切换时采用；只会是 `initial` / `current`） */
  tab: CharacterViewTab;
  /** 阅读进度四态（提示文案与「是否回落人物档案」共用同一判据） */
  positionState: CharacterPositionState;
}

/**
 * 默认 tab 判据（卡片 3.2 原口径，保留为组合件）：设置了 `current_position` → 「阅读进度」；未设置 → 「人物档案」。
 */
export function resolveDefaultTab(currentPosition: string | null | undefined): CharacterViewTab {
  return typeof currentPosition === "string" && currentPosition.trim() !== ""
    ? "current"
    : "initial";
}

/** 阅读进度状态（四态；供 tab 判据与提示文案共用——`unset` 与 `invalid` 文案不同，不得合并） */
export type CharacterPositionState = "pending" | "unset" | "invalid" | "ok";

/**
 * 阅读进度状态判据（四态）：
 * - `pending`：`config` 未加载——无法区分「未设置」与「未加载」，**不得瞬时误判**；
 * - `unset`：已确认未设置（`current_position` 为 null/空串）；
 * - `invalid`：已设置但指向的节点不在当前大纲树里（已软删/被删）；
 * - `ok`：已设置且有效（**大纲未到位时也算 ok**——位置存在就展示默认视图，不误判失效）。
 */
export function resolvePositionState(input: {
  configLoaded: boolean;
  currentPosition: string | null | undefined;
  outlineLoaded: boolean;
  nodeIds: readonly string[];
}): CharacterPositionState {
  if (!input.configLoaded) return "pending";
  if (resolveDefaultTab(input.currentPosition) === "initial") return "unset";
  if (!input.outlineLoaded) return "ok";
  return input.nodeIds.includes(input.currentPosition as string) ? "ok" : "invalid";
}

/**
 * tab 判据（卡片 3.3；取代裸 `resolveDefaultTab` 作为容器入口）——两处避免错判：
 * 1. **`config` 未加载** → `initial` + `pending`（不得瞬时误判为「未设置」）；
 * 2. **已设置但节点已失效** → `initial` + `invalid`（阅读进度 tab 算不出有意义结果）。
 * 判据单一来源 = `resolvePositionState`（提示文案与默认 tab 不会漂移）。
 */
export function resolveTabState(input: {
  configLoaded: boolean;
  currentPosition: string | null | undefined;
  outlineLoaded: boolean;
  nodeIds: readonly string[];
}): CharacterTabState {
  const positionState = resolvePositionState(input);
  return { tab: positionState === "ok" ? "current" : "initial", positionState };
}

/**
 * 阅读进度 tab 的进度节点默认值：`current_position` 必须**在大纲树里存在**（失效/软删 → 空串 = 要求手动选择）。
 * 与 `ComputePreview` 同口径——软删节点的计算结果无意义。
 */
export function resolveCurrentAtNode(
  currentPosition: string | null | undefined,
  nodeIds: readonly string[],
): string {
  if (typeof currentPosition !== "string" || currentPosition.trim() === "") return "";
  return nodeIds.includes(currentPosition) ? currentPosition : "";
}

/** 只读 JSON 序列化的截断上限（超长对象值给有界展示串） */
export const READONLY_JSON_MAX_LENGTH = 120;

/** 只读展示兑底文案（无法 JSON 序列化的值） */
export const READONLY_FALLBACK_TEXT = "—";

/** 标量判据（“、”连接分支的准入——对象/函数/Symbol 不参与字符串拼接，转走 JSON 分支） */
function isScalarForReadOnly(raw: unknown): boolean {
  return typeof raw !== "object" && typeof raw !== "function" && typeof raw !== "symbol";
}

/**
 * 只读取值 → 展示串（tab 2 只读字段视图 / 面板叶子 / 已有 `custom_fields` 值）：
 * undefined/null → 空串；标量 → `String()`；**全标量数组 → 「、」连接**（与列表摘要同款展示口径）；
 * **对象 / 含对象的数组 → 紧凑 JSON 序列化**（截断到 `READONLY_JSON_MAX_LENGTH`，序列化失败 → `READONLY_FALLBACK_TEXT`）。
 *
 * 为何选 JSON 而非统一 `—`：`custom_fields` 的嵌套值在阅读进度 tab 是作者对照「当前进度时的值」的唯一展示位，
 * 一律打成 `—` 会丢掉全部信息；截断则避免超长串擑破行布局（外层 `truncate` 只截显示宽度，数据侧给有界串更稳）。
 */
export function readOnlyFieldValue(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (Array.isArray(raw)) {
    if (raw.length === 0) return "";
    if (raw.every(isScalarForReadOnly)) return raw.map((x) => String(x)).join("、");
  } else if (typeof raw !== "object") {
    return String(raw);
  }
  try {
    const json = JSON.stringify(raw);
    if (json === undefined) return READONLY_FALLBACK_TEXT; // 防御：不可序列化值
    return json.length > READONLY_JSON_MAX_LENGTH
      ? `${json.slice(0, READONLY_JSON_MAX_LENGTH)}…`
      : json;
  } catch {
    return READONLY_FALLBACK_TEXT; // 循环引用等
  }
}
