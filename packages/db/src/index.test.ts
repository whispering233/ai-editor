// 冒烟测试：验证 @ai-editor/db 入口导出（T2.1：schema + connection 真实 API；T2.2：JSON 存储）
import { describe, expect, it } from "vitest";
import * as m from "./index.js";

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

  it("导出 JSON 存储（T2.2）与对话历史查询（T2.3）的真实 API", () => {
    // storage/atomic.ts
    expect(typeof m.writeJsonAtomic).toBe("function");
    expect(typeof m.nowIso).toBe("function");
    // storage/outline.ts
    expect(typeof m.readOutlineFile).toBe("function");
    expect(typeof m.writeOutlineFile).toBe("function");
    expect(typeof m.findOutlineNode).toBe("function");
    expect(typeof m.touchOutlineNode).toBe("function");
    expect(typeof m.updateOutlineNode).toBe("function");
    expect(typeof m.getOutlinePathIds).toBe("function");
    // storage/project.ts
    expect(typeof m.readProjectFile).toBe("function");
    expect(typeof m.writeProjectFile).toBe("function");
    // queries/chat.ts（T2.3 并行工作）
    expect(typeof m.insertChatMessage).toBe("function");
  });
});
