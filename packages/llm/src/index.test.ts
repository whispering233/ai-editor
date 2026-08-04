// 冒烟测试：验证 @whispering233/ai-editor-llm 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@whispering233/ai-editor-llm 入口冒烟", () => {
  it("可正常导入且能解析 workspace 依赖 @whispering233/ai-editor-shared", () => {
    expect(m).toBeDefined();
    expect(m.LLM_PKG_NAME).toBe("@whispering233/ai-editor-llm");
    expect(m.SHARED_DEP).toBe("@whispering233/ai-editor-shared");
  });
});
