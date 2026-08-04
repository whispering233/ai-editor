// S7.2 上下文组装测试：三层注入 / 聚焦注入 / 工具清单 / 预算截断 / usage 基线重置 / 极端输入
// 契约来源：doc/design/decisions.md 决策 6（分层预算 + usage 基线）、决策 7（三层注入）、
// 决策 18（成对裁剪语义复用 session）；纯内存断言，无 I/O。
import { describe, expect, it } from "vitest";
import type { LLMUsage } from "@whispering233/ai-editor-llm";
import { listTools } from "@whispering233/ai-editor-tools";
import {
  buildContext,
  DEFAULT_CONTEXT_BUDGETS,
  type ToolListEntry,
} from "./context";
import {
  FOCUS_TITLE,
  FOCUS_TRUNCATION_NOTICE,
  INSTRUCTION_TITLE,
  KERNEL_PROMPT,
  PROJECT_PROMPT_TITLE,
  TOOL_LIST_TITLE,
} from "./prompts";
import type { SessionMessage } from "./session";

// ============ 构造辅助 ============

function user(content: string): SessionMessage {
  return { role: "user", content };
}

function plainAssistant(content: string | null): SessionMessage {
  return { role: "assistant", content };
}

function toolCall(id: string): { id: string; type: "function"; function: { name: string; arguments: string } } {
  return { id, type: "function", function: { name: "query_entity", arguments: "{}" } };
}

function toolCallingAssistant(ids: string[]): SessionMessage {
  return { role: "assistant", content: null, tool_calls: ids.map((id) => toolCall(id)) };
}

function toolResult(id: string): SessionMessage {
  return { role: "tool", content: `result-${id}`, tool_call_id: id };
}

const MOCK_TOOLS: ToolListEntry[] = [
  { name: "get_entity", description: "按 ID 查询实体详情" },
  { name: "analyze_conflict", description: "分析冲突结构" },
];

// ============ 三层注入（决策 7） ============

describe("buildContext 三层提示词注入", () => {
  it("内核/项目/临时各自就位：system 消息包含三段内容与段标题", () => {
    const ctx = buildContext({
      history: [],
      projectPrompt: "力量体系：练气→筑基→金丹",
      instruction: "今天只讨论第三卷",
    });
    expect(ctx.messages).toHaveLength(1);
    const system = ctx.messages[0];
    expect(system.role).toBe("system");
    const content = system.content;
    // 内核层（默认 KERNEL_PROMPT，代码固定）
    expect(content).toContain(KERNEL_PROMPT);
    expect(content).toContain("创作顾问");
    // 项目层（用户可编辑，来自 project.json）
    expect(content).toContain(PROJECT_PROMPT_TITLE);
    expect(content).toContain("力量体系：练气→筑基→金丹");
    // 临时层（即时输入）
    expect(content).toContain(INSTRUCTION_TITLE);
    expect(content).toContain("今天只讨论第三卷");
  });

  it("空项目/空临时层自动跳过（不产生空段标题）", () => {
    const ctx = buildContext({ history: [], projectPrompt: "  ", instruction: "" });
    const content = ctx.messages[0].content;
    expect(content).toContain(KERNEL_PROMPT);
    expect(content).not.toContain(PROJECT_PROMPT_TITLE);
    expect(content).not.toContain(INSTRUCTION_TITLE);
  });

  it("内核提示词可覆盖（测试注入自定义内核）", () => {
    const ctx = buildContext({ history: [], kernelPrompt: "自定义内核" });
    expect(ctx.messages[0].content).toContain("自定义内核");
    expect(ctx.messages[0].content).not.toContain(KERNEL_PROMPT);
  });
});

// ============ 聚焦注入（决策 6 聚焦层，有/无两态） ============

describe("buildContext 聚焦注入", () => {
  it("有 focus：注入独立 system 消息（标题 + 内容），位于基础 system 与历史之间", () => {
    const ctx = buildContext({
      history: [user("Q1")],
      focus: "当前聚焦实体：张三（char-1），身份：主角",
    });
    expect(ctx.messages).toHaveLength(3);
    expect(ctx.messages[0].role).toBe("system");
    const focusMsg = ctx.messages[1];
    expect(focusMsg.role).toBe("system");
    expect(focusMsg.content).toContain(FOCUS_TITLE);
    expect(focusMsg.content).toContain("当前聚焦实体：张三");
    expect(ctx.messages[2]).toEqual(user("Q1"));
    // 聚焦 token 计入 meta
    expect(ctx.tokens.focus).toBeGreaterThan(0);
  });

  it("无 focus：不注入聚焦消息，历史紧接基础 system", () => {
    const ctx = buildContext({ history: [user("Q1")] });
    expect(ctx.messages).toHaveLength(2);
    expect(ctx.messages[1]).toEqual(user("Q1"));
    expect(ctx.tokens.focus).toBe(0);
  });
});

// ============ 工具清单注入（registry listTools） ============

describe("buildContext 工具清单注入", () => {
  it("注入工具清单：system 内嵌 name + description 一行", () => {
    const ctx = buildContext({ history: [], tools: MOCK_TOOLS });
    const content = ctx.messages[0].content;
    expect(content).toContain(TOOL_LIST_TITLE);
    expect(content).toContain("- get_entity：按 ID 查询实体详情");
    expect(content).toContain("- analyze_conflict：分析冲突结构");
  });

  it("默认取 registry listTools()（agent 依赖 tools）：真实工具名出现在清单中", () => {
    const tools = listTools();
    expect(tools.length).toBeGreaterThan(0);
    const ctx = buildContext({ history: [] });
    const content = ctx.messages[0].content;
    expect(content).toContain(TOOL_LIST_TITLE);
    expect(content).toContain(tools[0].name);
  });

  it("空工具清单：不产生工具清单段", () => {
    const ctx = buildContext({ history: [], tools: [] });
    expect(ctx.messages[0].content).not.toContain(TOOL_LIST_TITLE);
    expect(ctx.tokens.toolList).toBe(0);
  });
});

// ============ 预算截断：历史成对裁剪（决策 6 + 决策 18 同裁同留） ============

describe("buildContext 历史预算裁剪", () => {
  it("超预算裁历史不拆对：配对块完整保留或整块丢弃，无孤儿半对", () => {
    const history: SessionMessage[] = [
      user("a".repeat(200)), // 50 tokens
      toolCallingAssistant(["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ];
    // 预算 60：整条 91 tokens 超限 → 裁掉头部 user，保留尾部配对块（41 tokens）
    const ctx = buildContext({ history, budgets: { history: 60 } });
    expect(ctx.meta.historyTrimmed).toBe(true);
    expect(ctx.messages.slice(1)).toEqual([
      toolCallingAssistant(["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ]);
    expect(ctx.tokens.history).toBeLessThanOrEqual(60);
  });

  it("配对块放不下时整块丢弃（不拆对），宁可窗口为空", () => {
    const history: SessionMessage[] = [
      user("hi"), // 1 token
      toolCallingAssistant(["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ];
    // 预算 5：配对块 41 tokens 放不下 → 整块丢弃，回退保留 user("hi")
    const ctx = buildContext({ history, budgets: { history: 5 } });
    expect(ctx.meta.historyTrimmed).toBe(true);
    expect(ctx.messages.slice(1)).toEqual([user("hi")]);
    expect(ctx.tokens.history).toBeLessThanOrEqual(5);
  });

  it("预算 0：历史全部裁空，仍保留 system 消息（无孤儿）", () => {
    const ctx = buildContext({ history: [user("Q1")], budgets: { history: 0 } });
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].role).toBe("system");
    expect(ctx.meta.historyMessageCount).toBe(0);
  });

  it("未超预算不裁剪：历史原样保留（末条为 user，buildPayload 不干预）", () => {
    const history = [user("Q1"), plainAssistant("回答"), user("Q2")];
    const ctx = buildContext({ history, budgets: { history: 100 } });
    expect(ctx.meta.historyTrimmed).toBe(false);
    expect(ctx.messages.slice(1)).toEqual(history);
  });

  it("裁剪后末条约束仍成立：输出 messages 末条恒 user/tool（buildPayload 收尾）", () => {
    const history: SessionMessage[] = [
      user("Q1"),
      plainAssistant("半条回答"), // 末条 assistant——喂回前被修正
    ];
    const ctx = buildContext({ history });
    const last = ctx.messages[ctx.messages.length - 1];
    expect(["user", "tool"]).toContain(last.role);
    expect(ctx.messages).toEqual([{ role: "system", content: expect.any(String) }, user("Q1")]);
  });
});

// ============ usage 基线：裁剪后重置，防预算漂移（决策 6，2026-08 补充） ============

describe("buildContext usage 基线", () => {
  const smallUsage: LLMUsage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 };

  it("未触发裁剪时保留基线（真实 usage 优先）", () => {
    const history = [user("Q1")]; // ~1 token
    const ctx = buildContext({ history, lastUsage: smallUsage, budgets: { history: 100 } });
    expect(ctx.meta.lastUsageReset).toBe(false);
    expect(ctx.meta.effectiveLastUsage).toEqual(smallUsage);
  });

  it("带基线估算超预算 → 触发裁剪 → 基线重置为 null（旧 usage 描述裁剪前前缀，沿用即漂移）", () => {
    const history = [user("Q1")];
    const hugeUsage: LLMUsage = { prompt_tokens: 99999, completion_tokens: 1, total_tokens: 100000 };
    const ctx = buildContext({ history, lastUsage: hugeUsage, budgets: { history: 30 } });
    // 基线 100000 + 消息估算 ≫ 30 → 判定超限触发裁剪流程
    expect(ctx.meta.lastUsageReset).toBe(true);
    expect(ctx.meta.effectiveLastUsage).toBeNull();
    // 消息本身（无基线估算）不超预算 → 未裁条数，但估算不虚高（无漂移）
    expect(ctx.meta.historyTrimmed).toBe(false);
    expect(ctx.tokens.history).toBeLessThanOrEqual(30);
  });

  it("真实裁剪场景：裁剪后 tokens.history 基于重置后（无基线）估算，不虚高", () => {
    const history: SessionMessage[] = [
      user("a".repeat(200)), // 50 tokens
      user("b".repeat(200)), // 50 tokens
    ];
    const ctx = buildContext({ history, lastUsage: smallUsage, budgets: { history: 60 } });
    expect(ctx.meta.historyTrimmed).toBe(true);
    expect(ctx.meta.lastUsageReset).toBe(true);
    expect(ctx.meta.effectiveLastUsage).toBeNull();
    // 重置后按 chars/4 估算（≈50 tokens，不含陈旧基线 12）
    expect(ctx.tokens.history).toBeLessThanOrEqual(60);
  });

  it("基线缺省（null）等价于不传：不触发重置标记", () => {
    const ctx = buildContext({ history: [user("Q1")], lastUsage: null });
    expect(ctx.meta.lastUsageReset).toBe(false);
    expect(ctx.meta.effectiveLastUsage).toBeNull();
  });

  it("恰好边界：基线 + 历史估算 == 预算时不重置（严格大于才触发裁剪）", () => {
    // 历史 "1234567890" = 10 chars → ceil(10/4) = 3 tokens；基线 27 → 27+3 == 30 == 预算
    const history = [user("1234567890")];
    const boundaryUsage: LLMUsage = { prompt_tokens: 27, completion_tokens: 0, total_tokens: 27 };
    const ctx = buildContext({ history, lastUsage: boundaryUsage, budgets: { history: 30 } });
    expect(ctx.meta.lastUsageReset).toBe(false);
    expect(ctx.meta.historyTrimmed).toBe(false);
    expect(ctx.meta.effectiveLastUsage).toEqual(boundaryUsage);
    expect(ctx.tokens.history + boundaryUsage.total_tokens).toBe(30);
  });
});

// ============ 聚焦预算截断 ============

describe("buildContext 聚焦预算截断", () => {
  it("聚焦超预算：截断并显式告知（含截断提示），基础 system 不受影响", () => {
    const ctx = buildContext({
      history: [],
      focus: "a".repeat(400), // 100 tokens > 预算 20
      budgets: { focus: 20 },
    });
    expect(ctx.meta.focusTruncated).toBe(true);
    const focusMsg = ctx.messages[1];
    const focusContent = focusMsg.role === "system" ? focusMsg.content : "";
    expect(focusContent).toContain(FOCUS_TITLE);
    expect(focusContent).toContain(FOCUS_TRUNCATION_NOTICE);
    // 截断后聚焦内容长度受限
    expect(focusContent.length).toBeLessThan(200);
    // 基础 system 完整（内核仍在）
    expect(ctx.messages[0].content).toContain(KERNEL_PROMPT);
  });

  it("聚焦未超预算：原样保留、不截断", () => {
    const ctx = buildContext({ history: [], focus: "张三", budgets: { focus: 20 } });
    expect(ctx.meta.focusTruncated).toBe(false);
    const focusContent = ctx.messages[1].role === "system" ? ctx.messages[1].content : "";
    expect(focusContent).toContain("张三");
    expect(focusContent).not.toContain(FOCUS_TRUNCATION_NOTICE);
  });

  it("恰好边界：聚焦估算 == 预算时不截断（严格大于才截断）", () => {
    // 80 chars → ceil(80/4) == 20 == 预算 focus
    const focus = "a".repeat(80);
    const ctx = buildContext({ history: [], focus, budgets: { focus: 20 } });
    expect(ctx.meta.focusTruncated).toBe(false);
    const focusContent = ctx.messages[1].role === "system" ? ctx.messages[1].content : "";
    expect(focusContent).toContain(focus);
    expect(focusContent).not.toContain(FOCUS_TRUNCATION_NOTICE);
  });
});

// ============ 基础 system 预算与极端输入 ============

describe("buildContext 系统层与极端输入", () => {
  it("基础 system 超预算仅记录不裁剪（用户内容不可裁）", () => {
    const ctx = buildContext({
      history: [],
      projectPrompt: "p".repeat(4000),
      budgets: { system: 50 },
    });
    expect(ctx.meta.systemOverBudget).toBe(true);
    // 内容完整未被裁剪
    expect(ctx.messages[0].content).toContain("p".repeat(4000));
  });

  it("极端输入防御：全空输入仍输出含内核的 system 消息", () => {
    const ctx = buildContext({ history: [] });
    expect(ctx.messages).toHaveLength(1);
    expect(ctx.messages[0].content).toContain(KERNEL_PROMPT);
    expect(ctx.tokens.total).toBeGreaterThan(0);
  });

  it("默认预算常量为决策 6 分层值", () => {
    expect(DEFAULT_CONTEXT_BUDGETS).toEqual({ system: 500, focus: 3000, history: 6000 });
  });
});
