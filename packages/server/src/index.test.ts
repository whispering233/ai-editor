// 冒烟测试：验证 @ai-editor/server 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/server 入口冒烟", () => {
  it("可正常导入且能解析 workspace 依赖 @ai-editor/agent", () => {
    expect(m).toBeDefined();
    expect(m.SERVER_PKG_NAME).toBe("@ai-editor/server");
    expect(m.AGENT_DEP).toBe("@ai-editor/agent");
  });
});
