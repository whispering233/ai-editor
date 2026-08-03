// S7.1 会话管理测试：成对裁剪 / 孤儿半对丢弃 / 重建格式 / 末条约束 / 重试 payload
// 契约来源：doc/design/decisions.md 决策 18、doc/design/tasks.md S7.1
// 纯内存断言，无 I/O——直接构造 mock 消息序列调用 session 状态机函数链。
import { describe, expect, it } from "vitest";
import type { ChatMessageRow } from "@ai-editor/shared";
import type { LLMMessage } from "@ai-editor/llm";
import {
  appendMessage,
  buildPayload,
  loadHistory,
  restoreSession,
  retryPayload,
  trimSession,
  type SessionMessage,
} from "./session";

// ============ 构造辅助 ============

function user(content: string): SessionMessage {
  return { role: "user", content };
}

function plainAssistant(content: string | null): SessionMessage {
  return { role: "assistant", content };
}

/** 构造 LLMToolCallRequest 形态的工具调用（arguments 为 JSON 字符串，与流式累积格式一致） */
function toolCall(id: string, name = "query_entity"): { id: string; type: "function"; function: { name: string; arguments: string } } {
  return { id, type: "function", function: { name, arguments: "{}" } };
}

function toolCallingAssistant(content: string | null, ids: string[]): SessionMessage {
  return { role: "assistant", content, tool_calls: ids.map((id) => toolCall(id)) };
}

function toolResult(id: string, content = `result-${id}`): SessionMessage {
  return { role: "tool", content, tool_call_id: id };
}

/** 构造 ChatMessageRow（持久化行形态，created_at 为 ISO 字符串） */
function row(
  role: ChatMessageRow["role"],
  id: string,
  createdAt: string,
  extra: Partial<ChatMessageRow> = {},
): ChatMessageRow {
  return {
    id,
    session_id: "sess-test",
    project_id: "proj-test",
    role,
    content: role === "tool" ? `result-${id}` : null,
    tool_calls: null,
    tool_call_id: null,
    created_at: createdAt,
    ...extra,
  };
}

// ============ 成对裁剪（同裁同留，不拆对） ============

describe("trimSession 成对裁剪", () => {
  /** 成对不变式：窗口内每个 tool 消息都有其 assistant（且 assistant 在窗口内），
   *  每个带 tool_calls 的 assistant 都有全部 tool 结果（同裁同留，无孤儿半对） */
  function assertPairInvariant(trimmed: SessionMessage[]): void {
    const toolResults = new Set(trimmed.filter((m) => m.role === "tool").map((m) => (m as { tool_call_id: string }).tool_call_id));
    const calledIds = new Set(
      trimmed
        .filter((m) => m.role === "assistant" && (m as { tool_calls?: unknown[] }).tool_calls?.length)
        .flatMap((m) => (m as { tool_calls: Array<{ id: string }> }).tool_calls.map((c) => c.id)),
    );
    // 窗口内的 tool 结果必须全部被窗口内的 assistant 引用（无孤儿 tool）
    expect(calledIds).toEqual(toolResults);
  }

  it("裁剪边界恰在 tool 消息处时不拆对：放不下的整对整块丢弃，不留下孤儿 tool", () => {
    // 尾部配对块 [assistant(tc-a, tc-b), tool(a), tool(b)] 共 3 条，maxCount=2 放不下——
    // 裸条数截取会留下 [tool(a), tool(b)] 孤儿半对；块级裁剪整块丢弃、回退到更早的 user
    const session: SessionMessage[] = [
      user("Q1"),
      toolCallingAssistant(null, ["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ];
    const trimmed = trimSession(session, 2);
    expect(trimmed).toEqual([user("Q1")]);
    assertPairInvariant(trimmed);
  });

  it("尾部整对恰好放满窗口时完整保留（不因差一条而拆对）", () => {
    // 配对块 [assistant(tc-a, tc-b), tool(a), tool(b)] 恰 3 条 = maxCount → 完整保留
    const session: SessionMessage[] = [
      user("Q1"),
      user("Q2"),
      toolCallingAssistant(null, ["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ];
    const trimmed = trimSession(session, 3);
    expect(trimmed).toEqual([
      toolCallingAssistant(null, ["tc-a", "tc-b"]),
      toolResult("tc-a"),
      toolResult("tc-b"),
    ]);
    assertPairInvariant(trimmed);
  });

  it("多窗口尺寸不变式：同裁同留，无孤儿半对", () => {
    const session: SessionMessage[] = [
      user("Q1"),
      toolCallingAssistant(null, ["tc-1"]),
      toolResult("tc-1"),
      plainAssistant("A1"),
      user("Q2"),
      toolCallingAssistant(null, ["tc-2", "tc-3"]),
      toolResult("tc-2"),
      toolResult("tc-3"),
      plainAssistant("A2"),
      user("Q3"),
    ];
    for (let maxCount = 1; maxCount <= session.length + 2; maxCount++) {
      const trimmed = trimSession(session, maxCount);
      expect(trimmed.length).toBeLessThanOrEqual(maxCount);
      assertPairInvariant(trimmed);
    }
  });

  it("多轮长历史：只保留尾部完整配对块", () => {
    const session: SessionMessage[] = [
      user("Q1"),
      toolCallingAssistant(null, ["tc-1"]),
      toolResult("tc-1"),
      plainAssistant("A1"),
      user("Q2"),
      toolCallingAssistant(null, ["tc-2"]),
      toolResult("tc-2"),
      plainAssistant("A2"),
      user("Q3"),
    ];
    const trimmed = trimSession(session, 4);
    // 尾部累计：块[user3](1) → 块[assistant A2](1) → 块[assistant(tc-2), tool(tc-2)](2) 恰好满 4
    expect(trimmed).toEqual([
      toolCallingAssistant(null, ["tc-2"]),
      toolResult("tc-2"),
      plainAssistant("A2"),
      user("Q3"),
    ]);
  });

  it("maxCount 非法值防御：0 或负数返回空数组", () => {
    const session: SessionMessage[] = [user("Q1")];
    expect(trimSession(session, 0)).toEqual([]);
    expect(trimSession(session, -1)).toEqual([]);
  });
});

// ============ 孤儿半对丢弃（重建时整对不喂回） ============

describe("loadHistory 孤儿半对丢弃", () => {
  it("tool_call 已写、tool_result 未写（中断落在调用后）→ assistant 整组不喂回", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "问题" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [{ id: "tc-a", type: "function", function: { name: "query_entity", arguments: "{}" } }],
      }),
      // 缺 tool(tc-a) 行
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([user("问题")]);
  });

  it("tool_result 已写、tool_call 未写（中断落在结果侧）→ 孤儿 tool 整对不喂回", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "问题" }),
      row("tool", "m2", "2026-08-01T00:00:01.000Z", { content: "result-tc-a", tool_call_id: "tc-a" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([user("问题")]);
  });

  it("多轮混合：完整轮保留、半对轮整组丢弃、后续轮不受影响", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [{ id: "tc-1", type: "function", function: { name: "query_entity", arguments: "{}" } }],
      }),
      row("tool", "m3", "2026-08-01T00:00:02.000Z", { content: "result-tc-1", tool_call_id: "tc-1" }),
      row("user", "m4", "2026-08-01T00:00:03.000Z", { content: "Q2" }),
      row("assistant", "m5", "2026-08-01T00:00:04.000Z", {
        content: null,
        tool_calls: [{ id: "tc-2", type: "function", function: { name: "query_entity", arguments: "{}" } }],
      }),
      // 缺 tool(tc-2) → m5 半对
      row("user", "m6", "2026-08-01T00:00:05.000Z", { content: "Q3" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([
      user("Q1"),
      toolCallingAssistant(null, ["tc-1"]),
      toolResult("tc-1"),
      user("Q2"),
      user("Q3"),
    ]);
  });

  it("tool_calls 形态不合法（缺 id）→ 该 assistant 整组丢弃", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [{ type: "function", function: { name: "query_entity", arguments: "{}" } }], // 缺 id
      }),
      row("tool", "m3", "2026-08-01T00:00:02.000Z", { content: "result-x", tool_call_id: "x" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([user("Q1")]);
  });
});

// ============ 重建格式（成对重组，跨多轮 / 多工具调用） ============

describe("loadHistory 成对重组", () => {
  it("多轮 + 多工具调用：tool 结果按 tool_calls 数组顺序紧随 assistant 输出", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [
          { id: "tc-a", type: "function", function: { name: "query_entity", arguments: "{}" } },
          { id: "tc-b", type: "function", function: { name: "analyze_conflict", arguments: "{}" } },
        ],
      }),
      row("tool", "m3", "2026-08-01T00:00:02.000Z", { content: "result-tc-b", tool_call_id: "tc-b" }),
      row("tool", "m4", "2026-08-01T00:00:03.000Z", { content: "result-tc-a", tool_call_id: "tc-a" }),
      row("user", "m5", "2026-08-01T00:00:04.000Z", { content: "Q2" }),
      row("assistant", "m6", "2026-08-01T00:00:05.000Z", { content: "最终回答" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([
      user("Q1"),
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "tc-a", type: "function", function: { name: "query_entity", arguments: "{}" } },
          { id: "tc-b", type: "function", function: { name: "analyze_conflict", arguments: "{}" } },
        ],
      },
      // 结果按 tool_calls 数组顺序输出（tc-a 在前），不随落库顺序
      toolResult("tc-a"),
      toolResult("tc-b"),
      user("Q2"),
      plainAssistant("最终回答"),
    ]);
  });

  it("输入乱序时按 created_at 升序稳定重组", () => {
    const rows: ChatMessageRow[] = [
      row("tool", "m3", "2026-08-01T00:00:02.000Z", { content: "result-tc-a", tool_call_id: "tc-a" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [{ id: "tc-a", type: "function", function: { name: "query_entity", arguments: "{}" } }],
      }),
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt).toEqual([user("Q1"), toolCallingAssistant(null, ["tc-a"]), toolResult("tc-a")]);
  });

  it("同一 tool_call_id 多条结果取最先到达者（防御性处理）", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", {
        content: null,
        tool_calls: [{ id: "tc-a", type: "function", function: { name: "query_entity", arguments: "{}" } }],
      }),
      row("tool", "m3", "2026-08-01T00:00:02.000Z", { content: "first", tool_call_id: "tc-a" }),
      row("tool", "m4", "2026-08-01T00:00:03.000Z", { content: "second", tool_call_id: "tc-a" }),
    ];
    const rebuilt = loadHistory(rows);
    expect(rebuilt[2]).toEqual(toolResult("tc-a", "first"));
  });
});

// ============ 末条约束（喂回序列末条恒 user/tool） ============

describe("buildPayload 末条约束", () => {
  it("assistant 结尾的序列被修正：丢弃尾部 assistant（失败轮半条不喂回）", () => {
    const session: SessionMessage[] = [user("Q1"), plainAssistant("半条回答")];
    const payload = buildPayload(session);
    expect(payload).toEqual([user("Q1")]);
    expect(payload[payload.length - 1].role).toBe("user");
  });

  it("assistant(带 tool_calls) 结尾（半对产物）整条丢弃", () => {
    const session: SessionMessage[] = [user("Q1"), toolCallingAssistant(null, ["tc-a"])];
    const payload = buildPayload(session);
    expect(payload).toEqual([user("Q1")]);
  });

  it("合法序列（末条 tool / user）原样输出", () => {
    const valid1: SessionMessage[] = [user("Q1"), toolCallingAssistant(null, ["tc-a"]), toolResult("tc-a")];
    expect(buildPayload(valid1)).toEqual(valid1);
    const valid2: SessionMessage[] = [user("Q1"), plainAssistant("回答"), user("Q2")];
    expect(buildPayload(valid2)).toEqual(valid2);
  });

  it("裁剪 + 喂回全链：末条恒 user/tool（含全 assistant 极端序列返回空数组）", () => {
    // 极端：只有 assistant 消息的序列 → 修正后为空（S7.3 视为无有效上下文）
    expect(buildPayload([plainAssistant("孤立回答")])).toEqual([]);
    // 全链：历史重建 → 追加失败轮半条 → 裁剪 → 喂回，末条恒 user/tool
    const session = appendMessage(
      loadHistory([
        row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
        row("assistant", "m2", "2026-08-01T00:00:01.000Z", { content: "回答1" }),
      ]),
      user("Q2"),
    );
    const payload = buildPayload(trimSession(session, 10));
    expect(payload).toEqual([user("Q1"), plainAssistant("回答1"), user("Q2")]);
    expect(["user", "tool"]).toContain(payload[payload.length - 1].role);
  });
});

// ============ 重试 payload（复用原数组，不含失败轮半条） ============

describe("retryPayload 重试复用", () => {
  it("重试复用原请求 messages 数组，不含失败轮半条 assistant", () => {
    // 第一次请求的 payload（成功发送给模型的那份）
    const original: LLMMessage[] = [user("Q1")];
    // 失败轮产生的半条 assistant（绝不能追加进重试序列）
    const failedTail: SessionMessage = plainAssistant("半条回答");

    const retried = retryPayload(original);
    expect(retried).toEqual(original);
    expect(retried).not.toContainEqual(failedTail);
  });

  it("返回拷贝：调用方修改返回值不影响原数组", () => {
    const original: LLMMessage[] = [user("Q1")];
    const retried = retryPayload(original);
    retried.push(user("被污染"));
    expect(original).toHaveLength(1);
  });
});

// ============ 组合入口 ============

describe("restoreSession 组合入口", () => {
  it("加载历史 + 成对裁剪一步完成（服务重启续聊）", () => {
    const rows: ChatMessageRow[] = [
      row("user", "m1", "2026-08-01T00:00:00.000Z", { content: "Q1" }),
      row("assistant", "m2", "2026-08-01T00:00:01.000Z", { content: "A1" }),
      row("user", "m3", "2026-08-01T00:00:02.000Z", { content: "Q2" }),
      row("assistant", "m4", "2026-08-01T00:00:03.000Z", { content: "A2" }),
    ];
    const restored = restoreSession(rows, 2);
    expect(restored).toEqual([user("Q2"), plainAssistant("A2")]);
  });
});
