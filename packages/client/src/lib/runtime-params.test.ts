// 设置页「高级 → 运行参数」的文本口径（`lib/runtime-params.ts`）：
// 读 settings.json → 三个值（空文本 / 空对象 = 皆缺省；坏 JSON / 顶层非对象 / 类型不符 = 原因），
// 三个值 → 整份文本（**浅合并**：retry / compaction 的其它字段与顶层未知键原样保留；undefined = 删键）。
// 下界依据 = pi `schemas/settings.schema.json`（`httpIdleTimeoutMs` = number minimum 0 或 "disabled"）。
import { describe, expect, it } from "vitest";
import {
  HTTP_IDLE_TIMEOUT_MIN_MS,
  composeSettingsText,
  httpIdleTimeoutProblem,
  readRuntimeParams,
  type RuntimeParams,
} from "./runtime-params";

const EMPTY: RuntimeParams = {
  retryEnabled: undefined,
  compactionEnabled: undefined,
  httpIdleTimeoutMs: undefined,
};

describe("readRuntimeParams", () => {
  it("空文本 / 空对象 → 三项皆缺省（原文对象为空）", () => {
    expect(readRuntimeParams("")).toEqual({ ok: true, params: EMPTY, original: {} });
    expect(readRuntimeParams(" \n\t ")).toEqual({ ok: true, params: EMPTY, original: {} });
    expect(readRuntimeParams("{}")).toEqual({ ok: true, params: EMPTY, original: {} });
  });

  it("正常文件 → 读出三项（其它字段留在 original 里）", () => {
    const result = readRuntimeParams(
      '{ "retry": { "enabled": false, "maxRetries": 5 }, "compaction": { "enabled": true }, "httpIdleTimeoutMs": 60000 }',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params).toEqual({ retryEnabled: false, compactionEnabled: true, httpIdleTimeoutMs: 60000 });
    expect(result.original).toMatchObject({ retry: { maxRetries: 5 } });
  });

  it("只有其它字段 → 三项仍缺省（不把「未设置」读成 false）", () => {
    const result = readRuntimeParams('{ "retry": { "maxRetries": 4 } }');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params).toEqual(EMPTY);
  });

  it("坏 JSON（注释 / 尾逗号）→ 失败并给出原因", () => {
    for (const text of ['{ "retry": ', '{ // 注释\n "retry": {} }', '{ "retry": {}, }']) {
      const result = readRuntimeParams(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("JSON");
    }
  });

  it("顶层非对象（数组 / 字符串 / null / 数字）→ 失败", () => {
    for (const text of ["[]", '"x"', "null", "42"]) {
      const result = readRuntimeParams(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("对象");
    }
  });

  it("enabled 非 boolean → 失败并指名键", () => {
    for (const text of ['{ "retry": { "enabled": "yes" } }', '{ "compaction": { "enabled": 1 } }']) {
      const result = readRuntimeParams(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain(".enabled");
    }
  });

  it("retry / compaction 不是对象 → 失败", () => {
    const result = readRuntimeParams('{ "retry": 5 }');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("retry 必须是对象");
  });

  it("httpIdleTimeoutMs 非数字 / 负数 / 非整数 → 失败并说明（字符串形态指路 JSON）", () => {
    const disabled = readRuntimeParams('{ "httpIdleTimeoutMs": "disabled" }');
    expect(disabled.ok).toBe(false);
    if (!disabled.ok) expect(disabled.reason).toContain("数字毫秒");

    for (const raw of ["-1", "1500.5", "true"]) {
      const result = readRuntimeParams(`{ "httpIdleTimeoutMs": ${raw} }`);
      expect(result.ok).toBe(false);
    }
  });

  it("httpIdleTimeoutMs = 0 合法（schema 下界，pi 把它当「关闭空闲超时」）", () => {
    const result = readRuntimeParams('{ "httpIdleTimeoutMs": 0 }');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.params.httpIdleTimeoutMs).toBe(HTTP_IDLE_TIMEOUT_MIN_MS);
  });
});

describe("httpIdleTimeoutProblem", () => {
  it("合法：0 与正整数", () => {
    expect(httpIdleTimeoutProblem(0)).toBeNull();
    expect(httpIdleTimeoutProblem(300_000)).toBeNull();
  });

  it("非法：负数 / 小数 / 非有限值 —— 文案里的下界由常量插值", () => {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const problem = httpIdleTimeoutProblem(value);
      expect(problem).toContain(String(HTTP_IDLE_TIMEOUT_MIN_MS));
    }
  });
});

describe("composeSettingsText", () => {
  it("只写这三项：其它字段（maxRetries / 未知键 / 其它顶层键）原样保留", () => {
    const original = {
      defaultModel: "deepseek-chat",
      retry: { enabled: true, maxRetries: 5, baseDelayMs: 1000 },
      compaction: { enabled: false, reserveTokens: 16384 },
      customKey: { nested: true },
    };

    const text = composeSettingsText(original, {
      retryEnabled: false,
      compactionEnabled: true,
      httpIdleTimeoutMs: 60_000,
    });

    expect(JSON.parse(text)).toEqual({
      defaultModel: "deepseek-chat",
      retry: { enabled: false, maxRetries: 5, baseDelayMs: 1000 },
      compaction: { enabled: true, reserveTokens: 16384 },
      customKey: { nested: true },
      httpIdleTimeoutMs: 60_000,
    });
    expect(text).toContain('\n  "retry"'); // 两空格缩进
  });

  it("「默认」= 删键：enabled 被删掉，容器里的其它字段还在", () => {
    const text = composeSettingsText(
      { retry: { enabled: true, maxRetries: 3 }, compaction: { enabled: false } },
      { ...EMPTY },
    );

    expect(JSON.parse(text)).toEqual({ retry: { maxRetries: 3 } });
    expect(text).not.toContain("enabled");
  });

  it("容器里只有 enabled 时删键 → 连容器一起删", () => {
    expect(composeSettingsText({ retry: { enabled: true } }, EMPTY)).toBe("{}");
  });

  it("httpIdleTimeoutMs 留空 → 删键（原文有值也删）", () => {
    const text = composeSettingsText({ httpIdleTimeoutMs: 5000 }, EMPTY);

    expect(JSON.parse(text)).toEqual({});
  });

  it("原文空 → 只写被设置的值（可被自身读回）", () => {
    const text = composeSettingsText({}, { retryEnabled: true, compactionEnabled: undefined, httpIdleTimeoutMs: 0 });

    expect(JSON.parse(text)).toEqual({ retry: { enabled: true }, httpIdleTimeoutMs: 0 });
    expect(readRuntimeParams(text)).toEqual({
      ok: true,
      params: { retryEnabled: true, compactionEnabled: undefined, httpIdleTimeoutMs: 0 },
      original: { retry: { enabled: true }, httpIdleTimeoutMs: 0 },
    });
  });
});