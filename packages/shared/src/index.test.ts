// 冒烟测试：验证 @ai-editor/shared 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/shared 入口冒烟", () => {
  it("可正常导入且导出包名常量", () => {
    expect(m).toBeDefined();
    expect(m.SHARED_PKG_NAME).toBe("@ai-editor/shared");
    expect(m.SHARED_PKG_VERSION).toBe("0.1.0");
  });
});
