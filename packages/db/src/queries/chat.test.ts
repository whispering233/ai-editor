// T2.3 对话历史数据层测试
// 覆盖：插入 / 项目隔离（决策 18 修订）/ 会话列表倒序与截断 / 消息历史升序与 JSON 解析 /
// 成对重组（决策 18 修订：孤儿半对整对丢弃，多轮交错）
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatMessageRow, ChatRole } from "@ai-editor/shared";
import { closeDatabase, openDatabase, type Db } from "../connection";
import { insertChatMessage, listMessages, listSessions, reassembleMessages } from "./chat";

let dir: string;
let dbPath: string;
let db: Db;

/** 自增 id 计数器：避免测试内重复主键 */
let seq = 0;

/** 构造一条 ChatMessageRow（id 自动生成，其余字段默认置空） */
function msg(p: {
  session_id: string;
  project_id: string;
  role: ChatRole;
  created_at: string;
  content?: string | null;
  tool_calls?: unknown[] | null;
  tool_call_id?: string | null;
}): ChatMessageRow {
  seq += 1;
  return {
    id: `m-${seq}`,
    content: null,
    tool_calls: null,
    tool_call_id: null,
    ...p,
  };
}

beforeEach(() => {
  seq = 0;
  dir = mkdtempSync(join(tmpdir(), "ai-editor-db-chat-"));
  dbPath = join(dir, "data.db");
  db = openDatabase(dbPath);
});

afterEach(() => {
  closeDatabase(db);
  rmSync(dir, { recursive: true, force: true });
});

describe("chat.ts insertChatMessage", () => {
  it("插入后可读回，tool_calls 数组落库为 JSON 文本", () => {
    const calls = [{ id: "call_1", name: "query_entity", arguments: { id: "char-1" } }];
    insertChatMessage(db, msg({
      session_id: "sess-1",
      project_id: "proj-a",
      role: "assistant",
      content: "我来查一下",
      tool_calls: calls,
      created_at: "2026-08-01T10:00:00Z",
    }));
    const raw = db
      .prepare("SELECT tool_calls FROM chat_messages WHERE id = ?")
      .get("m-1") as { tool_calls: string } | undefined;
    expect(raw).toBeDefined();
    expect(JSON.parse(raw!.tool_calls)).toEqual(calls);
  });

  it("省略 id 时自动用 nanoid 生成，主键非空且可查", () => {
    insertChatMessage(db, {
      session_id: "sess-1",
      project_id: "proj-a",
      role: "user",
      content: "你好",
      created_at: "2026-08-01T10:00:00Z",
    });
    const messages = listMessages(db, "sess-1", "proj-a");
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBeTruthy();
  });
});

describe("chat.ts 项目隔离（决策 18 修订）", () => {
  it("两个项目的数据互不可见：会话列表与消息历史均按 project_id 过滤", () => {
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "A 项目消息", created_at: "2026-08-01T10:00:00Z" }));
    insertChatMessage(db, msg({ session_id: "sess-2", project_id: "proj-b", role: "user", content: "B 项目消息", created_at: "2026-08-01T11:00:00Z" }));

    // 会话列表互相不可见
    const aSessions = listSessions(db, "proj-a");
    const bSessions = listSessions(db, "proj-b");
    expect(aSessions.map((s) => s.id)).toEqual(["sess-1"]);
    expect(bSessions.map((s) => s.id)).toEqual(["sess-2"]);

    // 消息历史：跨项目查询同 session_id 返回空（同 id 不同项目互不可见）
    expect(listMessages(db, "sess-1", "proj-b")).toEqual([]);
    expect(listMessages(db, "sess-2", "proj-a")).toEqual([]);
    // 本项目内正常返回
    expect(listMessages(db, "sess-1", "proj-a")).toHaveLength(1);
  });
});

describe("chat.ts listSessions", () => {
  it("按最后活动时间倒序，messageCount / createdAt / updatedAt 正确", () => {
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "早", created_at: "2026-08-01T10:00:00Z" }));
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "中", created_at: "2026-08-01T10:05:00Z" }));
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "晚", created_at: "2026-08-01T10:10:00Z" }));
    insertChatMessage(db, msg({ session_id: "sess-2", project_id: "proj-a", role: "user", content: "另一个会话", created_at: "2026-08-01T11:00:00Z" }));

    const sessions = listSessions(db, "proj-a");
    // sess-2 最后活动更晚 → 排最前
    expect(sessions.map((s) => s.id)).toEqual(["sess-2", "sess-1"]);
    expect(sessions[1]).toMatchObject({
      id: "sess-1",
      messageCount: 3,
      createdAt: "2026-08-01T10:00:00Z",
      updatedAt: "2026-08-01T10:10:00Z",
      lastMessage: "晚",
    });
    expect(sessions[0]).toMatchObject({ id: "sess-2", messageCount: 1, lastMessage: "另一个会话" });
  });

  it("lastMessage 超长截断（含省略号，总长不超过 SESSION_LAST_MESSAGE_MAX_LEN）", () => {
    const long = "很长的消息内容。".repeat(30);
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: long, created_at: "2026-08-01T10:00:00Z" }));

    const [s] = listSessions(db, "proj-a");
    expect(s.lastMessage.length).toBeLessThanOrEqual(50);
    expect(s.lastMessage.endsWith("…")).toBe(true);
    // 截断前 49 字 + 省略号
    expect(s.lastMessage).toBe(`${long.slice(0, 49)}…`);
  });

  it("最后一条消息无 content（如纯工具调用）时 lastMessage 为空串，不抛错", () => {
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "早", created_at: "2026-08-01T10:00:00Z" }));
    insertChatMessage(db, msg({
      session_id: "sess-1", project_id: "proj-a", role: "assistant",
      tool_calls: [{ id: "call_1", name: "query_entity", arguments: {} }],
      created_at: "2026-08-01T10:05:00Z",
    }));

    const [s] = listSessions(db, "proj-a");
    expect(s.lastMessage).toBe("");
    expect(s.updatedAt).toBe("2026-08-01T10:05:00Z");
  });

  it("无消息的会话不出现；无任何消息时返回空数组", () => {
    expect(listSessions(db, "proj-a")).toEqual([]);
  });
});

describe("chat.ts listMessages", () => {
  it("按 created_at 升序返回，存储形态转 API 形态（tool_calls 解析、toolCallId 映射）", () => {
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "第一条", created_at: "2026-08-01T10:00:00Z" }));
    insertChatMessage(db, msg({
      session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "我来查",
      tool_calls: [{ id: "call_1", name: "query_entity", arguments: { id: "char-1" } }],
      created_at: "2026-08-01T10:01:00Z",
    }));
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "{\"name\":\"张三\"}", tool_call_id: "call_1", created_at: "2026-08-01T10:02:00Z" }));

    const messages = listMessages(db, "sess-1", "proj-a");
    expect(messages.map((m) => m.role)).toEqual(["user", "assistant", "tool"]);
    expect(messages.map((m) => m.createdAt)).toEqual([
      "2026-08-01T10:00:00Z",
      "2026-08-01T10:01:00Z",
      "2026-08-01T10:02:00Z",
    ]);
    // tool_calls JSON 解析为数组
    expect(messages[1].toolCalls).toEqual([{ id: "call_1", name: "query_entity", arguments: { id: "char-1" } }]);
    // tool_call_id 映射为 toolCallId
    expect(messages[2].toolCallId).toBe("call_1");
    expect(messages[2].content).toBe('{"name":"张三"}');
    // 无工具调用的消息不出现 toolCalls 字段（undefined）
    expect(messages[0].toolCalls).toBeUndefined();
  });

  it("tool_calls 列为非法 JSON / 非数组时防御性返回 undefined，不抛错", () => {
    insertChatMessage(db, msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "坏数据", created_at: "2026-08-01T10:00:00Z" }));
    // 直接写坏 JSON 到 tool_calls 列
    db.prepare("UPDATE chat_messages SET tool_calls = '{not-json' WHERE id = ?").run("m-1");

    const [m] = listMessages(db, "sess-1", "proj-a");
    expect(m.toolCalls).toBeUndefined();
  });
});

describe("chat.ts reassembleMessages 成对重组（决策 18 修订）", () => {
  it("正常成对：assistant tool_call → tool 结果保留，工具结果按 tool_calls 顺序紧随其后", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "查两个人", created_at: "t1" }),
      msg({
        session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "开始查",
        tool_calls: [{ id: "call_1", name: "query_entity" }, { id: "call_2", name: "query_entity" }],
        created_at: "t2",
      }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果1", tool_call_id: "call_1", created_at: "t3" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果2", tool_call_id: "call_2", created_at: "t4" }),
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([
      { role: "user", content: "查两个人" },
      { role: "assistant", content: "开始查", toolCalls: [{ id: "call_1", name: "query_entity" }, { id: "call_2", name: "query_entity" }] },
      { role: "tool", toolCallId: "call_1", content: "结果1" },
      { role: "tool", toolCallId: "call_2", content: "结果2" },
    ]);
  });

  it("孤儿半对：assistant 有 tool_call 但无对应 tool 结果 → 整对丢弃", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "查一下", created_at: "t1" }),
      msg({
        session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "开始查",
        tool_calls: [{ id: "call_1", name: "query_entity" }],
        created_at: "t2",
      }),
    ];
    const out = reassembleMessages(rows);
    // user 保留，assistant（半对）整组丢弃
    expect(out).toEqual([{ role: "user", content: "查一下" }]);
  });

  it("孤儿半对：tool 结果无对应 assistant 调用 → 整对丢弃", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "查一下", created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "孤儿结果", tool_call_id: "call_99", created_at: "t2" }),
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([{ role: "user", content: "查一下" }]);
  });

  it("多轮交错：多组成对消息按序保留，夹在中间的孤儿 tool 消息被丢弃", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "第一轮", created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "处理中", tool_calls: [{ id: "call_1" }], created_at: "t2" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果A", tool_call_id: "call_1", created_at: "t3" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "第二轮", created_at: "t4" }),
      // 夹在中间的孤儿 tool 消息（无对应调用）
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "孤儿", tool_call_id: "call_99", created_at: "t5" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "继续", tool_calls: [{ id: "call_2" }], created_at: "t6" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果B", tool_call_id: "call_2", created_at: "t7" }),
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([
      { role: "user", content: "第一轮" },
      { role: "assistant", content: "处理中", toolCalls: [{ id: "call_1" }] },
      { role: "tool", toolCallId: "call_1", content: "结果A" },
      { role: "user", content: "第二轮" },
      { role: "assistant", content: "继续", toolCalls: [{ id: "call_2" }] },
      { role: "tool", toolCallId: "call_2", content: "结果B" },
    ]);
  });

  it("部分缺失：assistant 多个 tool_call 中仅一个缺结果 → 整组（assistant + 其余结果）丢弃", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "开始查", tool_calls: [{ id: "call_1" }, { id: "call_2" }], created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果1", tool_call_id: "call_1", created_at: "t2" }),
      // call_2 无结果
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([]);
  });

  it("无工具调用的 assistant / user 消息原样保留；tool_call 缺 id 的畸形调用整组丢弃", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "你好", created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "回复", created_at: "t2" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "畸形调用", tool_calls: [{ name: "query_entity" }], created_at: "t3" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果", tool_call_id: "call_1", created_at: "t4" }),
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([
      { role: "user", content: "你好" },
      { role: "assistant", content: "回复" },
    ]);
  });

  it("输入乱序时先按 created_at 升序排序再重组", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果", tool_call_id: "call_1", created_at: "t3" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "调用", tool_calls: [{ id: "call_1" }], created_at: "t2" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "user", content: "提问", created_at: "t1" }),
    ];
    const out = reassembleMessages(rows);
    expect(out).toEqual([
      { role: "user", content: "提问" },
      { role: "assistant", content: "调用", toolCalls: [{ id: "call_1" }] },
      { role: "tool", toolCallId: "call_1", content: "结果" },
    ]);
  });

  it("同一 tool_call_id 多条 tool 结果取最先到达者（assistant 配对用第一条，防御性处理）", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "调用", tool_calls: [{ id: "call_1" }], created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果-先", tool_call_id: "call_1", created_at: "t2" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果-后", tool_call_id: "call_1", created_at: "t3" }),
    ];
    const out = reassembleMessages(rows);
    // 后到的重复结果被跳过：tool 消息只输出一次，且 content 为最先到达者
    expect(out).toEqual([
      { role: "assistant", content: "调用", toolCalls: [{ id: "call_1" }] },
      { role: "tool", toolCallId: "call_1", content: "结果-先" },
    ]);
  });

  it("tool_calls 含非对象元素（如字符串）时整组丢弃（类型守卫路径）", () => {
    const rows = [
      msg({ session_id: "sess-1", project_id: "proj-a", role: "assistant", content: "畸形调用", tool_calls: [{ id: "call_1" }, "not-an-object"], created_at: "t1" }),
      msg({ session_id: "sess-1", project_id: "proj-a", role: "tool", content: "结果", tool_call_id: "call_1", created_at: "t2" }),
    ];
    const out = reassembleMessages(rows);
    // 字符串元素取 id 为 undefined → 缺 id 判定孤儿半对 → assistant + 其结果整组丢弃
    expect(out).toEqual([]);
  });
});
