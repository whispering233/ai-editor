// 冒烟测试：验证 @ai-editor/tools 入口可正常导入（T0.3 语义）
// 入口重写（S6.3）后原空壳常量（TOOLS_PKG_NAME/DB_DEP）已移除——
// 冒烟断言更新为新入口形态：注册表 API + 8 个查询工具副作用注册；
// workspace 依赖 @ai-editor/db / @ai-editor/shared 解析由 import 在编译/运行期验证
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/tools 入口冒烟", () => {
  it("可正常导入：注册表/上下文/查询工具 API 导出，且 8 个查询工具已注册", () => {
    expect(m).toBeDefined();
    // registry API
    expect(typeof m.registerTool).toBe("function");
    expect(typeof m.registerTools).toBe("function");
    expect(typeof m.getTool).toBe("function");
    expect(typeof m.listTools).toBe("function");
    // 查询工具实现导出（S6.3）
    expect(typeof m.runGetEntity).toBe("function");
    expect(typeof m.runSearchEntities).toBe("function");
    expect(typeof m.runQueryRelationships).toBe("function");
    expect(typeof m.runGetOutline).toBe("function");
    expect(typeof m.runGetOutlinePath).toBe("function");
    expect(typeof m.runComputeState).toBe("function");
    expect(typeof m.runGetDeltaHistory).toBe("function");
    expect(typeof m.runGetEntitySummary).toBe("function");
    // 入口副作用注册：8 个查询工具
    expect(m.toolCount()).toBeGreaterThanOrEqual(8);
    expect(m.getTool("get_entity")).toBeDefined();
  });
});
