// 冒烟测试：验证 @ai-editor/db 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/db 入口冒烟", () => {
  it("可正常导入且导出引擎常量", () => {
    expect(m).toBeDefined();
    expect(m.DB_PKG_NAME).toBe("@ai-editor/db");
    expect(m.DB_ENGINE).toBe("better-sqlite3");
  });
});
