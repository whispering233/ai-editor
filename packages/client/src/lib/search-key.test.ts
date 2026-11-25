// 联网搜索凭据的单字段文本口径（`lib/search-key.ts`）：
// 读文件 → 一个值（空文本 / 缺 apiKey = 未配置；坏 JSON / 非对象 / apiKey 非字符串 = 失败原因），
// 表单值 → 整份文本（apiKey 去空白；空串 = 清空）。未知键不在读取时处理（服务端 strict 会拒）。
import { describe, expect, it } from "vitest";
import { composeSearchConfigText, parseSearchKey } from "./search-key";

describe("parseSearchKey", () => {
  it("空文本 / 全空白 → 未配置（空串）", () => {
    expect(parseSearchKey("")).toEqual({ ok: true, apiKey: "" });
    expect(parseSearchKey(" \n\t ")).toEqual({ ok: true, apiKey: "" });
  });

  it("正常文件 → 取出 apiKey", () => {
    expect(parseSearchKey('{ "apiKey": "sk-deepseek" }')).toEqual({ ok: true, apiKey: "sk-deepseek" });
  });

  it("缺 apiKey（空对象）→ 未配置（schema 里 apiKey 可选）", () => {
    expect(parseSearchKey("{}")).toEqual({ ok: true, apiKey: "" });
  });

  it("坏 JSON → 失败并给出原因", () => {
    const result = parseSearchKey('{ "apiKey": ');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("JSON");
  });

  it("顶层非对象（数组 / 字符串 / null）→ 失败", () => {
    for (const text of ["[]", '"sk-x"', "null", "42"]) {
      const result = parseSearchKey(text);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toContain("对象");
    }
  });

  it("apiKey 非字符串 → 失败", () => {
    const result = parseSearchKey('{ "apiKey": 123 }');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain("apiKey");
  });

  it("带未知键仍能读出 apiKey（未知键的拒绝权归服务端 strict 校验）", () => {
    expect(parseSearchKey('{ "apiKey": "sk-x", "extra": 1 }')).toEqual({ ok: true, apiKey: "sk-x" });
  });
});

describe("composeSearchConfigText", () => {
  it("单键 JSON（去首尾空白 + 两空格缩进）", () => {
    expect(composeSearchConfigText("  sk-deepseek \n")).toBe('{\n  "apiKey": "sk-deepseek"\n}');
  });

  it("空串仍是合法文件（= 未配置），可被自身读回", () => {
    const text = composeSearchConfigText("");
    expect(parseSearchKey(text)).toEqual({ ok: true, apiKey: "" });
  });
});