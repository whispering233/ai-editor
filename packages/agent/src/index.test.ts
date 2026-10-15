// 冒烟测试：验证 @whispering233/ai-editor-agent 入口可正常导入，且运行时装配面已导出
import { describe, expect, it } from "vitest";
import * as m from "./index";

describe("@whispering233/ai-editor-agent 入口冒烟", () => {
  it("可正常导入且能解析 workspace 依赖 @whispering233/ai-editor-tools", () => {
    expect(m.AGENT_PKG_NAME).toBe("@whispering233/ai-editor-agent");
    expect(m.TOOLS_DEP).toBe("@whispering233/ai-editor-tools");
  });

  it("装配面导出齐全（运行时 / 事件投影 / 工具与提案）", () => {
    expect(typeof m.createProjectRuntime).toBe("function");
    expect(typeof m.toSseFrame).toBe("function");
    expect(typeof m.createSessionFrame).toBe("function");
    expect(typeof m.createPingFrame).toBe("function");
    expect(typeof m.createCustomTools).toBe("function");
    expect(typeof m.createProposalSink).toBe("function");
    expect(typeof m.projectMessageForWire).toBe("function");
    expect(typeof m.projectSessionsDir).toBe("function");
    expect(m.SESSIONS_DIR_NAME).toBe("sessions");
    expect(m.KERNEL_PROMPT).toContain("创作顾问");
  });

  it("内核提示词按工作区类型分叉：KERNEL_PROMPTS 是唯一映射（两份常量并列维护）", () => {
    expect(m.KERNEL_PROMPTS).toEqual({ novel: m.KERNEL_PROMPT, practice: m.PRACTICE_KERNEL_PROMPT });
    expect(m.PRACTICE_KERNEL_PROMPT).toContain("写作陪练");
    expect(m.PRACTICE_KERNEL_PROMPT).not.toContain("创作顾问");
  });

  it("提案仓：模块级单例 + 常量（confirm/reject 路由与对话链路同仓消费）", () => {
    expect(typeof m.defaultProposalStore.clear).toBe("function");
    expect(m.PROPOSAL_TTL_MS).toBe(10 * 60_000);
    expect(m.PROPOSAL_MAX_COUNT).toBeGreaterThan(0);
  });
});
