// jsonc 走查（语义对齐 pi `dist/utils/json.js` 的 `stripJsonComments`）
//
// 消费方：服务端 `checkConfigFileText`（models.json 宽容口径）；客户端模型表单**卡 3b 起**才接线
// （届时用 `parseJsonc` 读自定义 provider、`countJsoncLosses` 决定是否弹「会丢 N 处注释」）——
// 当前 `packages/client` 下零命中。
import { describe, expect, it } from "vitest";
import { countJsoncLosses, parseJsonc, stripJsonComments } from "./jsonc.js";

describe("stripJsonComments", () => {
  it("// 行注释与尾逗号都去掉，结果可 JSON.parse", () => {
    const text = '{\n  // 自定义 provider\n  "a": 1,\n}\n';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ a: 1 });
  });

  it("字符串字面量里的 // 不是注释（URL 原样保留）", () => {
    const text = '{ "baseUrl": "https://api.example.com/v1" }';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ baseUrl: "https://api.example.com/v1" });
  });

  it("字符串里出现的尾逗号样式也不动（\", }\" 在引号内）", () => {
    const text = '{ "s": "a, }", "n": 1 }';
    expect(JSON.parse(stripJsonComments(text))).toEqual({ s: "a, }", n: 1 });
  });

  it("无注释无尾逗号的严格 JSON 原样返回", () => {
    const text = '{"providers":{"x":{"baseUrl":"http://a"}},"n":[1,2]}';
    expect(stripJsonComments(text)).toBe(text);
  });

  it("嵌套对象 / 数组里的注释与尾逗号同样去掉（保留缩进换行）", () => {
    const text = '{\n  "providers": {\n    "x": [1, 2,],\n  },\n}\n';
    expect(stripJsonComments(text)).toBe('{\n  "providers": {\n    "x": [1, 2]\n  }\n}\n');
  });
});

describe("parseJsonc", () => {
  it("成功 → ok:true + 值（BOM 一并去掉）", () => {
    expect(parseJsonc('\uFEFF{ "a": 1, // x\n}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it("失败 → ok:false + reason（不抛）", () => {
    const result = parseJsonc("{ 坏 ");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toBe("");
  });
});

describe("countJsoncLosses", () => {
  it("严格 JSON → 0（保存不会丢东西）", () => {
    expect(countJsoncLosses('{ "url": "https://a", "n": [1, 2] }')).toBe(0);
  });

  it("按处数统计：注释与尾逗号各自计数", () => {
    const text = '{\n  // 一\n  "a": 1, // 二\n  "b": [1, 2,],\n}\n';
    expect(countJsoncLosses(text)).toBe(4); // 2 行注释 + b 数组尾逗号 + 顶层尾逗号
  });

  it("与 stripJsonComments 同口径：strip 后等处原文时 = 0", () => {
    for (const text of ['{"a":1}', '{"a":1,}', '// c\n{"a":1}', '{"a":"//x"}']) {
      expect(countJsoncLosses(text) === 0).toBe(stripJsonComments(text) === text);
    }
  });
});