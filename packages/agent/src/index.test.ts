// 冒烟测试：验证 @ai-editor/agent 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/agent 入口冒烟", () => {
  it("可正常导入且能解析 workspace 依赖 @ai-editor/tools", () => {
    expect(m).toBeDefined();
    expect(m.AGENT_PKG_NAME).toBe("@ai-editor/agent");
    expect(m.TOOLS_DEP).toBe("@ai-editor/tools");
  });
});
