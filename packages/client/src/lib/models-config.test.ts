// `models.json` 表单纯函数走查（契约 = docs/ui/DESIGN.md `tab-advanced` → `models-providers`；
// 字段约束以 pi `schemas/models.schema.json` 为准）。
// 守两条硬纪律：未知键原样透传（只覆盖表单负责的字段）、空文本 = 无自定义 provider（不是解析失败）。
import { describe, expect, it } from "vitest";
import {
  commentsLostOnSave,
  composeModelsText,
  emptyProviderForm,
  hasProviderErrors,
  readCustomProviders,
  validateProviderForm,
  type CustomProviderForm,
} from "./models-config";

/** 读 + 改名 + 回写一步到位（多数用例的公共路径） */
function roundTrip(text: string, edit: (providers: CustomProviderForm[]) => CustomProviderForm[]): string {
  const parsed = readCustomProviders(text);
  if (!parsed.ok) throw new Error(parsed.reason);
  return composeModelsText(parsed.original, edit(parsed.providers));
}

describe("readCustomProviders", () => {
  it("空文本 = 无自定义 provider（不报解析失败）", () => {
    expect(readCustomProviders("")).toEqual({ ok: true, original: {}, providers: [] });
    expect(readCustomProviders("  \n")).toEqual({ ok: true, original: {}, providers: [] });
  });

  it("没有 providers 键 = 空列表，顶层其余键仍进原始对象", () => {
    const result = readCustomProviders('{ "$schema": "./models.schema.json" }');
    expect(result).toMatchObject({ ok: true, providers: [] });
    expect(result.ok && result.original).toEqual({ $schema: "./models.schema.json" });
  });

  it("带 // 注释与尾逗号也能读（与 pi 读口径同一套语义）", () => {
    const text = `{
  // 我的网关
  "providers": {
    "gw": { "name": "网关", "baseUrl": "https://a/v1", },
  },
}`;
    const result = readCustomProviders(text);
    expect(result.ok).toBe(true);
    expect(result.ok && result.providers.map((p) => [p.id, p.name, p.baseUrl])).toEqual([
      ["gw", "网关", "https://a/v1"],
    ]);
  });

  it("坏 JSON / 顶层非对象 / providers 非对象 → reason", () => {
    const bad = readCustomProviders("{ providers: ");
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toContain("不是合法 JSON");
    expect(readCustomProviders("[]")).toMatchObject({ ok: false, reason: "顶层必须是 JSON 对象" });
    expect(readCustomProviders('{ "providers": [] }')).toMatchObject({
      ok: false,
      reason: "providers 必须是 JSON 对象",
    });
  });

  it("provider / 模型行形状不对 → reason（不静默丢弃）", () => {
    expect(readCustomProviders('{ "providers": { "gw": 1 } }')).toMatchObject({
      ok: false,
      reason: "provider「gw」必须是 JSON 对象",
    });
    expect(readCustomProviders('{ "providers": { "gw": { "models": {} } } }')).toMatchObject({
      ok: false,
      reason: "provider「gw」的 models 必须是数组",
    });
    expect(readCustomProviders('{ "providers": { "gw": { "models": [1] } } }')).toMatchObject({
      ok: false,
      reason: "provider「gw」的模型行必须是 JSON 对象",
    });
  });

  it("模型行读成表单值：数字转字符串、reasoning 布尔、其余进 extra", () => {
    const text = `{ "providers": { "gw": { "models": [
      { "id": "m1", "name": "M1", "contextWindow": 200000, "maxTokens": 8192, "reasoning": true, "cost": { "input": 1 } }
    ] } } }`;
    const result = readCustomProviders(text);
    expect(result.ok).toBe(true);
    const row = result.ok ? result.providers[0]?.models[0] : undefined;
    expect(row).toMatchObject({ id: "m1", name: "M1", contextWindow: "200000", maxTokens: "8192", reasoning: true });
    expect(row?.extra).toEqual({ cost: { input: 1 } });
  });
});

describe("composeModelsText", () => {
  const SOURCE = `{
  "$schema": "./models.schema.json",
  "customTop": 42,
  "providers": {
    "gw": {
      "name": "网关",
      "baseUrl": "https://old/v1",
      "apiKey": "$GW_KEY",
      "headers": { "X-Org": "acme" },
      "compat": { "supportsStore": false },
      "models": [
        { "id": "m1", "name": "M1", "contextWindow": 128000, "cost": { "input": 0.5 }, "input": ["text"] }
      ]
    }
  }
}`;

  it("只覆盖表单字段：顶层 / provider / 模型级的未知键全部透传", () => {
    const text = roundTrip(SOURCE, (providers) => [
      { ...providers[0]!, baseUrl: "https://new/v1" },
    ]);
    const written = JSON.parse(text) as Record<string, unknown>;

    expect(written.$schema).toBe("./models.schema.json");
    expect(written.customTop).toBe(42);
    const gw = (written.providers as Record<string, Record<string, unknown>>).gw;
    expect(gw).toMatchObject({
      name: "网关",
      baseUrl: "https://new/v1",
      apiKey: "$GW_KEY",
      headers: { "X-Org": "acme" },
      compat: { supportsStore: false },
    });
    expect(gw.models).toEqual([
      { id: "m1", name: "M1", contextWindow: 128000, cost: { input: 0.5 }, input: ["text"] },
    ]);
  });

  it("新建 provider：写进 providers，已有家与未知键不动", () => {
    const text = roundTrip(SOURCE, (providers) => [
      ...providers,
      { ...emptyProviderForm(), id: "new", name: "新家", baseUrl: "https://new/v1", api: "openai-completions" },
    ]);
    const providers = (JSON.parse(text) as { providers: Record<string, Record<string, unknown>> }).providers;

    expect(Object.keys(providers)).toEqual(["gw", "new"]);
    expect(providers.new).toEqual({ name: "新家", baseUrl: "https://new/v1", api: "openai-completions" });
  });

  it("删除 provider：从 providers 里去掉，顶层键仍在", () => {
    const text = roundTrip(SOURCE, () => []);
    expect(JSON.parse(text)).toEqual({ $schema: "./models.schema.json", customTop: 42, providers: {} });
  });

  it("模型行：清空的数字 / 名称 = 删键，reasoning 关 = 不写", () => {
    const text = roundTrip(SOURCE, (providers) => [
      {
        ...providers[0]!,
        models: [{ ...providers[0]!.models[0]!, name: "", contextWindow: "", reasoning: false }],
      },
    ]);
    const model = (JSON.parse(text) as { providers: Record<string, { models: unknown[] }> }).providers.gw!.models[0];
    expect(model).toEqual({ id: "m1", cost: { input: 0.5 }, input: ["text"] });
  });

  it("模型行增删：加一行写入、删一行消失（顺序按表单）", () => {
    const added = roundTrip(SOURCE, (providers) => [
      {
        ...providers[0]!,
        models: [
          ...providers[0]!.models,
          { id: "m2", name: "", contextWindow: "200000", maxTokens: "8192", reasoning: true, extra: {} },
        ],
      },
    ]);
    expect((JSON.parse(added) as { providers: { gw: { models: unknown[] } } }).providers.gw.models).toEqual([
      { id: "m1", name: "M1", contextWindow: 128000, cost: { input: 0.5 }, input: ["text"] },
      { id: "m2", contextWindow: 200000, maxTokens: 8192, reasoning: true },
    ]);

    const removed = roundTrip(SOURCE, (providers) => [{ ...providers[0]!, models: [] }]);
    expect(JSON.parse(removed)).toMatchObject({ providers: { gw: { name: "网关" } } });
    expect((JSON.parse(removed) as { providers: { gw: Record<string, unknown> } }).providers.gw.models).toBeUndefined();
  });

  it("authHeader 只在勾选时写（缺省 false 不落键）", () => {
    const off = roundTrip(SOURCE, (providers) => [{ ...providers[0]!, authHeader: false }]);
    const on = roundTrip(SOURCE, (providers) => [{ ...providers[0]!, authHeader: true }]);
    expect((JSON.parse(off) as { providers: { gw: Record<string, unknown> } }).providers.gw.authHeader).toBeUndefined();
    expect((JSON.parse(on) as { providers: { gw: Record<string, unknown> } }).providers.gw.authHeader).toBe(true);
  });
});

describe("validateProviderForm", () => {
  const form = (patch: Partial<CustomProviderForm> = {}): CustomProviderForm => ({
    ...emptyProviderForm(),
    id: "gw",
    ...patch,
  });

  it("provider id 必填；已存在的 id 报重复", () => {
    expect(validateProviderForm(form({ id: "  " })).id).toBe("必填");
    expect(validateProviderForm(form(), ["gw"]).id).toContain("已存在");
    expect(validateProviderForm(form(), ["other"]).id).toBeNull();
  });

  it("模型 id 必填，同一 provider 内不重复", () => {
    const errors = validateProviderForm(
      form({
        models: [
          { id: "", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} },
          { id: "m1", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} },
          { id: " m1 ", name: "", contextWindow: "", maxTokens: "", reasoning: false, extra: {} },
        ],
      }),
    );
    expect(errors.models.map((row) => row.id)).toEqual(["必填", null, "模型 id 重复"]);
  });

  it("contextWindow / maxTokens 只收正整数或空", () => {
    const errors = validateProviderForm(
      form({
        models: [
          { id: "a", name: "", contextWindow: "128000", maxTokens: "", reasoning: false, extra: {} },
          { id: "b", name: "", contextWindow: "0", maxTokens: "1.5", reasoning: false, extra: {} },
          { id: "c", name: "", contextWindow: "-1", maxTokens: "abc", reasoning: false, extra: {} },
        ],
      }),
    );
    expect(errors.models.map((row) => row.contextWindow)).toEqual([null, "填正整数或留空", "填正整数或留空"]);
    expect(errors.models.map((row) => row.maxTokens)).toEqual([null, "填正整数或留空", "填正整数或留空"]);
  });

  it("hasProviderErrors 汇总（合法表单 = false）", () => {
    expect(hasProviderErrors(validateProviderForm(form()))).toBe(false);
    expect(hasProviderErrors(validateProviderForm(form({ id: "" })))).toBe(true);
  });
});

describe("commentsLostOnSave", () => {
  it("接入 shared countJsoncLosses：注释 / 尾逗号计入，干净 JSON 为 0", () => {
    expect(commentsLostOnSave('{ "providers": {} }')).toBe(0);
    expect(commentsLostOnSave('{\n  // 家\n  "providers": {},\n}')).toBe(2);
  });
});