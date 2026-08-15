// 冒烟测试：验证 @whispering233/ai-editor-tools 入口可正常导入（T0.3 语义）
// 入口重写（S6.3）后原空壳常量（TOOLS_PKG_NAME/DB_DEP）已移除——
// 冒烟断言更新为新入口形态：注册表 API + 工具副作用注册（S6.3 查询 8 + S6.4 分析 5 +
// S6.5 伏笔 5 + S6.6 提案 14 + F9 重排 1 = 33 个；S6.7 执行 13 个不暴露）；
// workspace 依赖 @whispering233/ai-editor-db / @whispering233/ai-editor-shared 解析由 import 在编译/运行期验证
import { describe, expect, it } from "vitest";
import { PROPOSAL_TOOLS } from "@whispering233/ai-editor-shared";
import * as m from "./index";

describe("@whispering233/ai-editor-tools 入口冒烟", () => {
  it("可正常导入：注册表/上下文/工具 API 导出，且查询/分析/伏笔/提案工具已注册", () => {
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
    // 提案工具实现导出（S6.6）
    expect(typeof m.runProposeCreateEntity).toBe("function");
    expect(typeof m.runProposeAddDelta).toBe("function");
    expect(typeof m.runProposeAdvanceHook).toBe("function");
    // 入口副作用注册：查询 8 + 分析 5 + 伏笔 5 + 提案 15 = 33 个
    expect(m.toolCount()).toBe(33);
    expect(m.getTool("get_entity")).toBeDefined();
    // 提案类工具权限为 PROPOSAL（tools.md「提案类（需确认）」）
    expect(m.getTool("propose_create_entity")!.permission).toBe("proposal");
    expect(m.getTool("propose_abandon_hook")!.permission).toBe("proposal");
    expect(m.getTool("propose_reorder_events")!.permission).toBe("proposal");
    // 15 个提案工具全部注册（PROPOSAL_TOOLS 常量与注册表一致，tools.md 契约）
    expect(PROPOSAL_TOOLS.length).toBe(15);
    for (const name of PROPOSAL_TOOLS) {
      expect(m.getTool(name)).toBeDefined();
    }
  });
});
