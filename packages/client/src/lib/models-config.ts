// 设置页「高级 → 自定义模型」的 `models.json` 表单口径（纯函数，可测）
// 契约 = docs/ui/DESIGN.md `tab-advanced` → `models-providers`（细节以 pi `schemas/models.schema.json` 为准）。
//
// 两条硬纪律：
// - **只覆盖表单负责的字段**：provider 级 `name` / `baseUrl` / `api` / `authHeader` / `apiKey`
//   （`id` 是 providers 的键），模型行 `id` / `name` / `contextWindow` / `maxTokens` / `reasoning`；
//   顶层与 provider / 模型级的其余键（`compat` / `cost` / `samplingParams*` / `inputLimits` / `modelOverrides`…）
//   一律经 `extra` 原样回写，**不在这里改名、不补默认值**。
// - 读侧走 shared `parseJsonc`（与 pi 的读口径同一套语义），**空文本 = 无自定义 provider**（不是解析失败）。
//
// `parse → stringify` 天然会丢注释 / 尾逗号：调用方保存前用 `commentsLostOnSave` 决定是否弹确认
// （服务端另留 `models.json.bak`，见 docs/api/90-api-settings.md）。
import { countJsoncLosses, parseJsonc } from "@whispering233/ai-editor-shared";

/** 表单里的一个模型行（数字字段留字符串：空 = 不写该键，便于「清空 = 删键」） */
export interface CustomModelRowForm {
  id: string;
  name: string;
  contextWindow: string;
  maxTokens: string;
  reasoning: boolean;
  /** 表单不负责的字段（`cost` / `input` / `inputLimits` / `compat`…），原样回写 */
  extra: Record<string, unknown>;
}

/** 表单里的一个自定义 provider（`id` = providers 的键，不是对象字段） */
export interface CustomProviderForm {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  authHeader: boolean;
  apiKey: string;
  models: CustomModelRowForm[];
  /** provider 级未知键（`headers` / `compat` / `modelOverrides`…），原样回写 */
  extra: Record<string, unknown>;
}

export type ReadProvidersResult =
  | { ok: true; original: Record<string, unknown>; providers: CustomProviderForm[] }
  | { ok: false; reason: string };

/** provider 级由表单负责的键（其余进 `extra`）；`id` 是 providers 的键，按定义不在对象里；
 * `models` 由模型行负责（不留在 `extra`，否则「删光模型行」会被旧数组原样写回） */
const PROVIDER_FORM_KEYS = ["name", "baseUrl", "api", "authHeader", "apiKey", "models"] as const;

/** 模型行表单负责的键（其余进 `extra`） */
const MODEL_FORM_KEYS = ["id", "name", "contextWindow", "maxTokens", "reasoning"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function textOf(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** 数字字段回填成字符串（缺失 / 非数字 = 空，不假装有值） */
function numberTextOf(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function restOf(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    if (!keys.includes(key)) rest[key] = value;
  }
  return rest;
}

function modelRowOf(raw: Record<string, unknown>): CustomModelRowForm {
  return {
    id: textOf(raw.id),
    name: textOf(raw.name),
    contextWindow: numberTextOf(raw.contextWindow),
    maxTokens: numberTextOf(raw.maxTokens),
    reasoning: raw.reasoning === true,
    extra: restOf(raw, MODEL_FORM_KEYS),
  };
}

type ProviderFormResult = { ok: true; provider: CustomProviderForm } | { ok: false; reason: string };

function providerFormOf(id: string, raw: Record<string, unknown>): ProviderFormResult {
  const rawModels = raw.models;
  if (rawModels !== undefined && !Array.isArray(rawModels)) {
    return { ok: false, reason: `provider「${id}」的 models 必须是数组` };
  }
  const models: CustomModelRowForm[] = [];
  for (const entry of rawModels ?? []) {
    if (!isRecord(entry)) return { ok: false, reason: `provider「${id}」的模型行必须是 JSON 对象` };
    models.push(modelRowOf(entry));
  }
  return {
    ok: true,
    provider: {
      id,
      name: textOf(raw.name),
      baseUrl: textOf(raw.baseUrl),
      api: textOf(raw.api),
      authHeader: raw.authHeader === true,
      apiKey: textOf(raw.apiKey),
      models,
      extra: restOf(raw, PROVIDER_FORM_KEYS),
    },
  };
}

/**
 * `models.json` 文本 → 自定义 provider 列表 + 顶层原始对象（未知键透传用）。
 * 空文本 = 空列表；坏 JSON / 结构不符 → `reason`（面板据此禁用编辑并指路 JSON 编辑器）。
 */
export function readCustomProviders(text: string): ReadProvidersResult {
  if (text.trim() === "") return { ok: true, original: {}, providers: [] };
  const parsed = parseJsonc(text);
  if (!parsed.ok) return { ok: false, reason: `不是合法 JSON（${parsed.reason}）` };
  if (!isRecord(parsed.value)) return { ok: false, reason: "顶层必须是 JSON 对象" };
  const original = parsed.value;
  const rawProviders = original.providers;
  if (rawProviders === undefined) return { ok: true, original, providers: [] };
  if (!isRecord(rawProviders)) return { ok: false, reason: "providers 必须是 JSON 对象" };
  const providers: CustomProviderForm[] = [];
  for (const [id, entry] of Object.entries(rawProviders)) {
    if (!isRecord(entry)) return { ok: false, reason: `provider「${id}」必须是 JSON 对象` };
    const one = providerFormOf(id, entry);
    if (!one.ok) return one;
    providers.push(one.provider);
  }
  return { ok: true, original, providers };
}

/** 字符串字段：去首尾空白，空 = 删键（表单负责的字段不保留旧值） */
function setOptionalText(target: Record<string, unknown>, key: string, value: string): void {
  const trimmed = value.trim();
  if (trimmed === "") delete target[key];
  else target[key] = trimmed;
}

/** 数字字段：空 = 删键；调用方已校验为正整数（这里只落值） */
function setOptionalNumber(target: Record<string, unknown>, key: string, value: string): void {
  const text = value.trim();
  if (text === "") delete target[key];
  else target[key] = Number(text);
}

function modelEntryOf(row: CustomModelRowForm): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...row.extra, id: row.id.trim() };
  setOptionalText(entry, "name", row.name);
  setOptionalNumber(entry, "contextWindow", row.contextWindow);
  setOptionalNumber(entry, "maxTokens", row.maxTokens);
  if (row.reasoning) entry.reasoning = true;
  return entry;
}

function providerEntryOf(provider: CustomProviderForm): Record<string, unknown> {
  const entry: Record<string, unknown> = { ...provider.extra };
  setOptionalText(entry, "name", provider.name);
  setOptionalText(entry, "baseUrl", provider.baseUrl);
  setOptionalText(entry, "api", provider.api);
  setOptionalText(entry, "apiKey", provider.apiKey);
  if (provider.authHeader) entry.authHeader = true;
  if (provider.models.length > 0) entry.models = provider.models.map(modelEntryOf);
  return entry;
}

/**
 * 顶层原始对象 + 表单 provider 列表 → 整份 `models.json` 文本。
 * `{...original, providers: {...}}`：顶层未知键原样在，provider / 模型级未知键经 `extra` 原样回写。
 */
export function composeModelsText(
  original: Record<string, unknown>,
  providers: readonly CustomProviderForm[],
): string {
  const entries: Record<string, unknown> = {};
  for (const provider of providers) entries[provider.id.trim()] = providerEntryOf(provider);
  return JSON.stringify({ ...original, providers: entries }, null, 2);
}

/** 表单保存会丢掉的注释 / 尾逗号处数（单源 = shared `countJsoncLosses`；0 = 不弹确认） */
export function commentsLostOnSave(text: string): number {
  return countJsoncLosses(text);
}

/** 一个模型行的校验错误（null = 没问题） */
export interface ModelRowErrors {
  id: string | null;
  contextWindow: string | null;
  maxTokens: string | null;
}

export interface ProviderFormErrors {
  id: string | null;
  models: ModelRowErrors[];
}

/** 正整数或空（pi schema：`exclusiveMinimum: 0`，表单不接受小数 / 负数 / 0） */
function positiveIntError(value: string): string | null {
  const text = value.trim();
  if (text === "") return null;
  if (!/^\d+$/.test(text) || Number(text) <= 0) return "填正整数或留空";
  return null;
}

/**
 * 弹窗校验：provider `id` 必填且不与 `takenIds`（其他已在文件里的 provider id）重复、
 * 模型 `id` 必填且同 provider 内不重复、数字字段正整数或空。
 */
export function validateProviderForm(
  form: CustomProviderForm,
  takenIds: readonly string[] = [],
): ProviderFormErrors {
  const id = form.id.trim();
  const idError =
    id === "" ? "必填" : takenIds.includes(id) ? "该 id 已存在（改名 = 删旧建新）" : null;
  const seen = new Set<string>();
  const models = form.models.map((row) => {
    const modelId = row.id.trim();
    let modelIdError: string | null = null;
    if (modelId === "") modelIdError = "必填";
    else if (seen.has(modelId)) modelIdError = "模型 id 重复";
    seen.add(modelId);
    return {
      id: modelIdError,
      contextWindow: positiveIntError(row.contextWindow),
      maxTokens: positiveIntError(row.maxTokens),
    };
  });
  return { id: idError, models };
}

/** 有任意一条错误（弹窗据此拦保存并就地展示） */
export function hasProviderErrors(errors: ProviderFormErrors): boolean {
  if (errors.id !== null) return true;
  return errors.models.some((row) => row.id !== null || row.contextWindow !== null || row.maxTokens !== null);
}

/** 「添加」用的空白 provider（无未知键、无模型行） */
export function emptyProviderForm(): CustomProviderForm {
  return {
    id: "",
    name: "",
    baseUrl: "",
    api: "",
    authHeader: false,
    apiKey: "",
    models: [],
    extra: {},
  };
}