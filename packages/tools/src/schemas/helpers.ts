// 工具参数 schema 共用 helper（形状对齐旧 zod `toJSONSchema()` 输出，模型-facing schema 逐字不变）
//
// 背景（独立 oracle 比对新旧 JSON Schema 发现的差异）：`Type.Enum(values)` 产出 `{"enum":[...]}`
// （无 type）、`Type.Record(...)` 产出 `patternProperties`；旧 zod 分别产出
// `{"type":"string","enum":[...]}` 与 `{"type":"object","additionalProperties":{},"propertyNames":{...}}`。
// 两者都是合法 JSON Schema，但为降低 OpenAI 兼容端点对少见形态的拒绝风险，这里用 `Type.Unsafe`
// 产出旧形状（`Enum`/`Record` 不再使用）。
//
// 校验语义：`Type.Unsafe` 不带 TypeBox Kind 标记 → pi 的 `validateToolArguments` 走纯 JSON Schema
// 路径（`coerceWithJsonSchema` + `Compile`），与 registry 的校验入口一致。

import { Type } from "@earendil-works/pi-ai";

/** 字符串枚举：产出 `{"type":"string","enum":[...]}`，并保留字面量联合类型推导 */
export function stringEnum<const T extends readonly string[]>(values: T) {
  return Type.Unsafe<T[number]>({ type: "string", enum: [...values] });
}

/** 自由形态对象（data / patches / metadata）：任意字符串键 + 任意值；可选 `minProperties`（拒绝空对象） */
export function freeFormObject(options: { minProperties?: number } = {}) {
  const schema: Record<string, unknown> = {
    type: "object",
    additionalProperties: {},
    propertyNames: { type: "string" },
  };
  if (options.minProperties !== undefined) schema.minProperties = options.minProperties;
  return Type.Unsafe<Record<string, unknown>>(schema);
}
