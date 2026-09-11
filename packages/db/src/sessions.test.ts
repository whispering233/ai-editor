// B1 会话 JSONL 文件存储测试：读写往返 / header 只写一次 / 读取容忍规则 /
// 列表聚合与稳定排序 / 删除 / 整文件重写幂等 / session_id 硬校验（路径穿越防线）
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ChatMessageRow } from "@whispering233/ai-editor-shared";
import {
  InvalidSessionIdError,
  appendSessionMessage,
  deleteSessionFile,
  isValidSessionId,
  listSessionSummaries,
  readSessionRows,
  sessionsDirPath,
  writeSessionFile,
} from "./sessions.js";

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-db-sessions-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});

/** 会话文件绝对路径（测试内部构造） */
function sessionFile(id: string): string {
  return join(sessionsDirPath(root), `${id}.jsonl`);
}

/** 直接落一份文件内容（构造异常形态用） */
function seedFile(id: string, content: string): void {
  mkdirSync(sessionsDirPath(root), { recursive: true });
  writeFileSync(sessionFile(id), content);
}

/** 存储形态行（writeSessionFile 用） */
function makeRow(partial: Partial<ChatMessageRow> & Pick<ChatMessageRow, "id" | "role" | "created_at">): ChatMessageRow {
  return {
    session_id: "sess_x",
    project_id: "",
    content: null,
    tool_calls: null,
    tool_call_id: null,
    ...partial,
  };
}

describe("appendSessionMessage / readSessionRows 往返", () => {
  it("首次追加写 header + 消息；三段消息（含 tool_calls / tool_call_id / content=null）往返一致", () => {
    const id = "sess_abc-123_XY";
    appendSessionMessage(root, id, { id: "m1", role: "user", content: "问题", created_at: "T1" });
    appendSessionMessage(root, id, {
      id: "m2",
      role: "assistant",
      content: null,
      tool_calls: [{ id: "call_1", type: "function", function: { name: "get_entity", arguments: "{}" } }],
      created_at: "T2",
    });
    appendSessionMessage(root, id, {
      id: "m3",
      role: "tool",
      content: "结果",
      tool_call_id: "call_1",
      created_at: "T3",
    });

    const rows = readSessionRows(root, id);
    expect(rows).toEqual([
      {
        id: "m1",
        session_id: id,
        project_id: "",
        role: "user",
        content: "问题",
        tool_calls: null,
        tool_call_id: null,
        created_at: "T1",
      },
      {
        id: "m2",
        session_id: id,
        project_id: "",
        role: "assistant",
        content: null,
        tool_calls: [{ id: "call_1", type: "function", function: { name: "get_entity", arguments: "{}" } }],
        tool_call_id: null,
        created_at: "T2",
      },
      {
        id: "m3",
        session_id: id,
        project_id: "",
        role: "tool",
        content: "结果",
        tool_calls: null,
        tool_call_id: "call_1",
        created_at: "T3",
      },
    ]);
  });

  it("header 只写一次：连续两次追加后行数 = 1 header + 2 消息，且 header.created_at = 首条消息时间", () => {
    const id = "sess_header";
    appendSessionMessage(root, id, { id: "m1", role: "user", content: "a", created_at: "T1" });
    appendSessionMessage(root, id, { id: "m2", role: "assistant", content: "b", created_at: "T2" });

    const lines = readFileSync(sessionFile(id), "utf8").trim().split("\n");
    expect(lines).toHaveLength(3);
    expect(JSON.parse(lines[0] as string)).toEqual({
      type: "session",
      version: 1,
      id,
      created_at: "T1",
    });
    expect(JSON.parse(lines[1] as string)).toMatchObject({ type: "message", id: "m1" });
    expect(JSON.parse(lines[2] as string)).toMatchObject({ type: "message", id: "m2" });
  });

  it("会话目录不存在时自动创建（含多层父目录）", () => {
    const nested = join(root, "books", "我的小说");
    expect(existsSync(sessionsDirPath(nested))).toBe(false);
    appendSessionMessage(nested, "sess_new", { id: "m1", role: "user", content: "x", created_at: "T1" });
    expect(readSessionRows(nested, "sess_new")).toHaveLength(1);
  });

  it("省略消息 id 时生成非空 id（与旧 insertChatMessage 一致）", () => {
    appendSessionMessage(root, "sess_auto", { role: "user", content: "x", created_at: "T1" });
    const rows = readSessionRows(root, "sess_auto");
    expect(rows).toHaveLength(1);
    expect(typeof rows[0]?.id).toBe("string");
    expect(rows[0]?.id).not.toBe("");
  });

  it("文件不存在 → 空数组（不抛错）", () => {
    expect(readSessionRows(root, "sess_missing")).toEqual([]);
  });
});

describe("读取容忍规则", () => {
  const id = "sess_tolerant";

  it("未知 type 行跳过（前向兼容：将来加 session_info / model_change 条目）且**不产生告警**", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedFile(
      id,
      [
        JSON.stringify({ type: "session", version: 1, id, created_at: "T0" }),
        JSON.stringify({ type: "session_info", name: "第一卷讨论" }),
        JSON.stringify({ type: "model_change", provider: "deepseek", modelId: "deepseek-v4-flash" }),
        JSON.stringify({ type: "message", id: "m1", role: "user", content: "x", created_at: "T1" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, id).map((r) => r.id)).toEqual(["m1"]);
    expect(warn).not.toHaveBeenCalled(); // 未知类型是合法前向兼容形态，不是异常
  });

  it("非法 JSON 行跳过 + 记日志（每文件一次告警）", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    seedFile(
      id,
      [
        JSON.stringify({ type: "session", version: 1, id, created_at: "T0" }),
        '{"type":"message","id":"m1","role":"user","content":"半截',
        JSON.stringify({ type: "message", id: "m2", role: "user", content: "完整", created_at: "T2" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, id).map((r) => r.id)).toEqual(["m2"]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain("1 行非法");
  });

  it("缺 created_at / 缺 id / role 非法的行跳过", () => {
    seedFile(
      id,
      [
        JSON.stringify({ type: "session", version: 1, id, created_at: "T0" }),
        JSON.stringify({ type: "message", id: "m1", role: "user", content: "缺时间" }),
        JSON.stringify({ type: "message", id: "", role: "user", content: "空 id", created_at: "T2" }),
        JSON.stringify({ type: "message", id: "m3", role: "system", content: "角色非法", created_at: "T3" }),
        JSON.stringify({ type: "message", id: "m4", role: "user", content: "合法", created_at: "T4" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, id).map((r) => r.id)).toEqual(["m4"]);
  });

  it("header 缺失（首行即消息行）→ 整个文件跳过", () => {
    seedFile(
      id,
      JSON.stringify({ type: "message", id: "m1", role: "user", content: "x", created_at: "T1" }) + "\n",
    );
    expect(readSessionRows(root, id)).toEqual([]);
  });

  it("header 版本超前（version: 2）→ 整个文件跳过，不猜", () => {
    seedFile(
      id,
      [
        JSON.stringify({ type: "session", version: 2, id, created_at: "T0" }),
        JSON.stringify({ type: "message", id: "m1", role: "user", content: "x", created_at: "T1" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, id)).toEqual([]);
  });

  it("header type 非 session / version 非整数 → 整个文件跳过", () => {
    seedFile(
      "sess_badtype",
      [
        JSON.stringify({ type: "not-session", version: 1, id: "sess_badtype", created_at: "T0" }),
        JSON.stringify({ type: "message", id: "m1", role: "user", content: "x", created_at: "T1" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, "sess_badtype")).toEqual([]);
  });

  it("tool_calls 非数组 → 按无工具调用处理（null）", () => {
    seedFile(
      id,
      [
        JSON.stringify({ type: "session", version: 1, id, created_at: "T0" }),
        JSON.stringify({ type: "message", id: "m1", role: "assistant", content: "x", tool_calls: "oops", created_at: "T1" }),
      ].join("\n") + "\n",
    );
    expect(readSessionRows(root, id)[0]?.tool_calls).toBeNull();
  });
});

describe("listSessionSummaries", () => {
  it("按 updatedAt 倒序、同值按 id 升序；lastMessage 截断；messageCount 计数", () => {
    const long = "很长的最后一条消息".repeat(10);
    appendSessionMessage(root, "sess_b", { id: "b1", role: "user", content: "b1", created_at: "2026-01-01T00:00:00Z" });
    appendSessionMessage(root, "sess_b", { id: "b2", role: "assistant", content: "b2", created_at: "2026-01-03T00:00:00Z" });
    appendSessionMessage(root, "sess_a", { id: "a1", role: "user", content: long, created_at: "2026-01-03T00:00:00Z" });
    appendSessionMessage(root, "sess_c", { id: "c1", role: "user", content: "c1", created_at: "2026-01-02T00:00:00Z" });

    const list = listSessionSummaries(root);
    // sess_a / sess_b 的 updatedAt 相同（2026-01-03）→ 按 id 升序；sess_c 最旧排最后
    expect(list.map((s) => s.id)).toEqual(["sess_a", "sess_b", "sess_c"]);
    expect(list[0]).toEqual({
      id: "sess_a",
      lastMessage: long.slice(0, 49) + "…", // 截断长度约定 = 50（含省略号）
      messageCount: 1,
      createdAt: "2026-01-03T00:00:00Z",
      updatedAt: "2026-01-03T00:00:00Z",
    });
    expect(list[1]?.messageCount).toBe(2);
    expect(list[1]?.createdAt).toBe("2026-01-01T00:00:00Z"); // header 创建时间
  });

  it("无消息文件（仅 header）/ 坏文件 / 非 .jsonl 文件 / 文件名非 sess_* → 均不参与", () => {
    seedFile("sess_only_header", JSON.stringify({ type: "session", version: 1, id: "sess_only_header", created_at: "T0" }) + "\n");
    seedFile("sess_broken", "not json at all\n");
    seedFile("sess_future", JSON.stringify({ type: "session", version: 9, id: "sess_future", created_at: "T0" }) + "\n");
    mkdirSync(sessionsDirPath(root), { recursive: true });
    writeFileSync(join(sessionsDirPath(root), "README.md"), "notes\n");
    writeFileSync(join(sessionsDirPath(root), "other.txt.jsonl"), "x\n");
    appendSessionMessage(root, "sess_ok", { id: "m1", role: "user", content: "x", created_at: "T1" });

    expect(listSessionSummaries(root).map((s) => s.id)).toEqual(["sess_ok"]);
  });

  it("目录不存在 → 空数组", () => {
    expect(listSessionSummaries(join(root, "nope"))).toEqual([]);
  });

  it("content 为 null 的末条 → lastMessage 空串", () => {
    appendSessionMessage(root, "sess_null", { id: "m1", role: "assistant", content: null, created_at: "T1" });
    expect(listSessionSummaries(root)[0]?.lastMessage).toBe("");
  });
});

describe("deleteSessionFile", () => {
  it("存在 → 删除并返回 true；再次调用返回 false", () => {
    appendSessionMessage(root, "sess_del", { id: "m1", role: "user", content: "x", created_at: "T1" });
    expect(deleteSessionFile(root, "sess_del")).toBe(true);
    expect(existsSync(sessionFile("sess_del"))).toBe(false);
    expect(deleteSessionFile(root, "sess_del")).toBe(false);
  });
});

describe("writeSessionFile（迁移路径）", () => {
  it("幂等：同一入参重复调用内容一致（含 header.created_at = 首行时间）", () => {
    const rows = [
      makeRow({ id: "m1", role: "user", content: "问题", created_at: "T1" }),
      makeRow({ id: "m2", role: "assistant", content: "回答", created_at: "T2" }),
    ];
    writeSessionFile(root, "sess_mig", rows);
    const first = readFileSync(sessionFile("sess_mig"), "utf8");
    writeSessionFile(root, "sess_mig", rows);
    expect(readFileSync(sessionFile("sess_mig"), "utf8")).toBe(first);
    expect(readSessionRows(root, "sess_mig")).toEqual(rows.map((r) => ({ ...r, session_id: "sess_mig" })));
    expect(listSessionSummaries(root)[0]).toMatchObject({ id: "sess_mig", messageCount: 2, createdAt: "T1" });
  });

  it("覆盖写：已有内容被整体替换（不留旧行）", () => {
    appendSessionMessage(root, "sess_ovr", { id: "old", role: "user", content: "旧", created_at: "T0" });
    writeSessionFile(root, "sess_ovr", [makeRow({ id: "new", role: "user", content: "新", created_at: "T1" })]);
    expect(readSessionRows(root, "sess_ovr").map((r) => r.id)).toEqual(["new"]);
  });

  it("空 rows → 仅 header 文件（读为空、不参与列表聚合）", () => {
    writeSessionFile(root, "sess_empty", []);
    const lines = readFileSync(sessionFile("sess_empty"), "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect(readSessionRows(root, "sess_empty")).toEqual([]);
    expect(listSessionSummaries(root)).toEqual([]);
  });

  it("不残留临时文件（原子写收尾）", () => {
    writeSessionFile(root, "sess_atomic", [makeRow({ id: "m1", role: "user", content: "x", created_at: "T1" })]);
    const files = readdirSync(sessionsDirPath(root));
    expect(files).toEqual(["sess_atomic.jsonl"]); // 无 .tmp 残留
    expect(readFileSync(sessionFile("sess_atomic"), "utf8").endsWith("\n")).toBe(true);
    expect(listSessionSummaries(root).map((s) => s.id)).toEqual(["sess_atomic"]);
  });
});

describe("session_id 硬校验（路径穿越防线）", () => {
  it("合法形态：字母/数字/下划线/连字符，长度 1-64", () => {
    expect(isValidSessionId("sess_abc-123_XY")).toBe(true);
    expect(isValidSessionId(`sess_${"a".repeat(64)}`)).toBe(true);
  });

  it("非法形态：路径穿越 / 空后缀 / 分隔符 / 超长 / 其他前缀", () => {
    for (const bad of ["../evil", "sess_../evil", "sess_", "sess_a/b", "sess_a\\b", `sess_${"a".repeat(65)}`, "sess_a b", "evil_abc", ""]) {
      expect(isValidSessionId(bad)).toBe(false);
    }
  });

  it("非法 id：读 / 写 / 删均抛 InvalidSessionIdError，且不触碰文件系统", () => {
    const bad = "../evil";
    expect(() => readSessionRows(root, bad)).toThrow(InvalidSessionIdError);
    expect(() => appendSessionMessage(root, bad, { role: "user", content: "x", created_at: "T1" })).toThrow(InvalidSessionIdError);
    expect(() => writeSessionFile(root, bad, [])).toThrow(InvalidSessionIdError);
    expect(() => deleteSessionFile(root, bad)).toThrow(InvalidSessionIdError);
    expect(existsSync(join(root, "..", "evil.jsonl"))).toBe(false);
  });

  it("错误对象携带 sessionId 供调用方写日志", () => {
    try {
      readSessionRows(root, "bad id");
      throw new Error("应当抛错");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidSessionIdError);
      expect((err as InvalidSessionIdError).sessionId).toBe("bad id");
    }
  });
});
