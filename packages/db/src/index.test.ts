// 冒烟测试：验证 @ai-editor/db 入口导出（T2.1：schema + connection 真实 API）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/db 入口冒烟", () => {
  it("导出 schema 与 connection 的真实 API", () => {
    expect(m).toBeDefined();
    // connection.ts
    expect(typeof m.openDatabase).toBe("function");
    expect(typeof m.closeDatabase).toBe("function");
    expect(typeof m.withTransaction).toBe("function");
    // schema.ts
    expect(typeof m.createTables).toBe("function");
    expect(typeof m.getUserVersion).toBe("function");
    expect(typeof m.setUserVersion).toBe("function");
    expect(typeof m.SCHEMA_VERSION).toBe("number");
  });
});
