// 冒烟测试：验证 @ai-editor/agent 入口可正常导入（T0.3）
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@ai-editor/agent 入口冒烟", () => {
  it("可正常导入且能解析 workspace 依赖 @ai-editor/tools", () => {
    expect(m).toBeDefined();
    expect(m.AGENT_PKG_NAME).toBe("@ai-editor/agent");
    expect(m.TOOLS_DEP).toBe("@ai-editor/tools");
  });

  it("S7.4 导出工具调度器与提案仓（createToolDispatcher / createProposalStore / 常量）", () => {
    expect(typeof m.createToolDispatcher).toBe("function");
    expect(typeof m.createProposalStore).toBe("function");
    expect(typeof m.defaultProposalStore.clear).toBe("function");
    expect(m.PROPOSAL_TTL_MS).toBe(10 * 60_000);
    expect(m.PROPOSAL_MAX_COUNT).toBeGreaterThan(0);
  });
});
