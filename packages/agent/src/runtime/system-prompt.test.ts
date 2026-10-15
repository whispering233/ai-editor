// 内核提示词 ↔ 工具名一致性（防两处漂移：改工具名漏改提示词 / 提示词提到不存在的工具）
//
// 为什么需要这条断言：工具集**按工作区类型收窄**是结构性边界（靠注册过滤），但「该用哪个工具」
// 只写在提示词里——提示词点名一个不存在或不属于本工作区的工具，模型就会调用一个它没有的工具
// （表现为失败的工具调用 + 白烧一轮）。两类漂移都在此处报红。
//
// 实现口径：练习内核提示词是**中文散文 + snake_case 工具名**，所以把提示词里出现的
// snake_case 标识符（≥ 1 个下划线）一律按工具名对待。若日后要在提示词里写字段名
//（如 `practice_sample_id`）或别的 snake_case 标识，需同改此断言（把该词纳入允许集或改写法）——
// 宁可在此报红，也不要让提示词引用一个不存在的工具。
import { describe, expect, it } from "vitest";
import { PRACTICE_TOOLS } from "@whispering233/ai-editor-shared";
import { PRACTICE_KERNEL_PROMPT } from "./system-prompt.js";

/** 从提示词里提取 snake_case 标识符（去重，保持出现顺序） */
function mentionedIdentifiers(prompt: string): string[] {
  return [...new Set(prompt.match(/[a-z]+(?:_[a-z]+)+/g) ?? [])];
}

describe("内核提示词 ↔ 工具名一致", () => {
  it("练习提示词提到的工具名必须 ⊆ 已注册的练习工具名（且全部练习工具都被点名）", () => {
    const mentioned = mentionedIdentifiers(PRACTICE_KERNEL_PROMPT);
    expect(mentioned.length).toBeGreaterThan(0); // 提示词必须点名工具，否则本断言空转
    expect(mentioned.filter((name) => !(PRACTICE_TOOLS as readonly string[]).includes(name))).toEqual([]);
    expect([...mentioned].sort()).toEqual([...PRACTICE_TOOLS].sort()); // 练习工具恰好都被点名（不重不漏，清单 = shared `PRACTICE_TOOLS`）
  });
});
