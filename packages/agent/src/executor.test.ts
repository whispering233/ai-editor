// S7.4 工具调度 + 提案内存仓测试
// 覆盖：批量校验 fail fast / 工具不存在与执行抛错 isError 结构化 / AbortedError 取消传播 /
//   提案执行（仓内可查 + proposal 事件数据构造 + tool_result 严格无预览）/ 假时钟 TTL /
//   条数上限淘汰（最旧）/ 项目隔离 / clear() / 同序等长回填 / 构建表完整性
// 契约来源：doc/design/tasks.md S7.4、doc/api/tools.md「工具执行契约」/「提案类」、
//   doc/design/decisions.md 决策 14/15/16。
// 策略：真注册表 + 唯一名 mock 工具（exec_test_*）+ 真 propose 工具（propose_outline_node
//   最小参数走纯函数路径，无 db/文件 I/O）；提案仓用独立实例 + 假时钟。agent 不依赖 db——
//   ToolContext.db 用 never 占位（registry.test.ts 同款模式），executor 只透传不触达。
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROPOSAL_TOOLS, TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { getEntityArgsSchema } from "@whispering233/ai-editor-shared/schemas/tools";
import { AbortedError, registerTool, type Proposal, type ToolContext } from "@whispering233/ai-editor-tools";
import {
  PROPOSAL_BUILDERS,
  PROPOSAL_MAX_COUNT,
  PROPOSAL_TTL_MS,
  createProposalStore,
  createToolDispatcher,
  defaultProposalStore,
} from "./executor";
import type { DispatchToolCall } from "./run";

// ============ 构造辅助 ============

/** 最小 ToolContext（agent 不依赖 db——executor 只透传，测试不触达 db/文件） */
function makeCtx(projectId = "proj-test"): ToolContext {
  return { db: undefined as never, outlineDir: "", projectId };
}

/** 构造 Proposal（提案仓直测用；createdAt 缺省取当前假时钟时刻） */
function makeProposal(id: string, projectId = "proj-1", createdAt?: string): Proposal {
  return {
    proposal_id: id,
    type: "propose_outline_node",
    args: {},
    project_id: projectId,
    references: [],
    summary: `摘要-${id}`,
    createdAt: createdAt ?? new Date().toISOString(),
  };
}

// ============ mock 工具注册（唯一名，模块级一次注册——registry 无注销 API） ============

/** run 收到的 signal 记录（断言「run 调用传 signal」用） */
const capturedSignals: Array<AbortSignal | undefined> = [];

/** exec_test_self_abort 的取消目标（测试内赋值；run 执行时中止它 → 模拟执行中途用户取消） */
const selfAbortState: { controller: AbortController | null } = { controller: null };

registerTool({
  name: "exec_test_echo",
  description: "executor 测试：正常返回",
  argsSchema: getEntityArgsSchema,
  permission: TOOL_PERMISSION.AUTO,
  run: (_ctx, _args, signal) => {
    capturedSignals.push(signal);
    return { result: 42 };
  },
});
registerTool({
  name: "exec_test_throw",
  description: "executor 测试：执行抛错",
  argsSchema: getEntityArgsSchema,
  permission: TOOL_PERMISSION.AUTO,
  run: () => {
    throw new Error("boom");
  },
});
registerTool({
  name: "exec_test_abort",
  description: "executor 测试：run 抛 AbortedError",
  argsSchema: getEntityArgsSchema,
  permission: TOOL_PERMISSION.AUTO,
  run: () => {
    throw new AbortedError();
  },
});
registerTool({
  name: "exec_test_self_abort",
  description: "executor 测试：run 执行中中止外部 controller（模拟执行中途取消）",
  argsSchema: getEntityArgsSchema,
  permission: TOOL_PERMISSION.AUTO,
  run: (_ctx, _args, signal) => {
    capturedSignals.push(signal); // 记录执行过的工具（断言后续工具未执行）
    selfAbortState.controller?.abort();
    return "ok";
  },
});
registerTool({
  name: "exec_test_abort_then_throw",
  description: "executor 测试：执行中中止 signal 后抛普通 Error（B1 兜底场景——工具未检查 signal）",
  argsSchema: getEntityArgsSchema,
  permission: TOOL_PERMISSION.AUTO,
  run: (_ctx, _args, signal) => {
    capturedSignals.push(signal);
    selfAbortState.controller?.abort();
    throw new Error("普通错误");
  },
});

// ============ 工具调度（ToolDispatcher 真实现） ============

describe("createToolDispatcher 工具调度（S7.4）", () => {
  beforeEach(() => {
    capturedSignals.length = 0;
  });

  it("多调用按输入顺序等长回填（成功/失败混合，id 一一对应——run.ts 契约）", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    const calls: DispatchToolCall[] = [
      { id: "call_1", tool: "exec_test_echo", args: { type: "character", id: "char-1" } },
      { id: "call_2", tool: "propose_outline_node", args: { type: "chapter", title: "第一卷" } },
      { id: "call_3", tool: "no_such_tool", args: {} },
      { id: "call_4", tool: "exec_test_throw", args: { type: "character", id: "char-2" } },
      { id: "call_5", tool: "get_entity", args: { type: "character" } }, // 缺 id → 校验失败
    ];
    const results = await dispatcher(calls);
    expect(results).toHaveLength(5);
    expect(results.map((r) => r.id)).toEqual(["call_1", "call_2", "call_3", "call_4", "call_5"]);
    expect(results.map((r) => r.tool)).toEqual([
      "exec_test_echo",
      "propose_outline_node",
      "no_such_tool",
      "exec_test_throw",
      "get_entity",
    ]);
    // 成功：结果序列化回填（ok 与 isError 同义同步赋值——run.ts 接口保留双字段，S7.3 审核 S4）
    expect(results[0]).toMatchObject({ id: "call_1", ok: true, isError: false, content: '{"result":42}' });
    // propose 成功：proposal 透传（proposal 事件数据在 tool_result 后由 run.ts 发出）
    expect(results[1].isError).toBe(false);
    expect(results[1].proposal?.type).toBe("propose_outline_node");
    // 工具不存在 → isError（不中断其他）
    expect(results[2]).toMatchObject({ id: "call_3", tool: "no_such_tool", ok: false, isError: true });
    expect(results[2].content).toContain("no_such_tool");
    // 执行抛错 → isError 结构化（工具名 + 参数 + 错误信息，决策 15 喂回自纠）
    expect(results[3]).toMatchObject({ id: "call_4", tool: "exec_test_throw", ok: false, isError: true });
    expect(results[3].content).toContain("exec_test_throw");
    expect(results[3].content).toContain("char-2");
    expect(results[3].content).toContain("boom");
    // 参数校验失败 → isError（未执行）
    expect(results[4]).toMatchObject({ id: "call_5", tool: "get_entity", ok: false, isError: true });
    expect(results[4].content).toContain("参数校验失败");
    expect(results[4].content).toContain("id");
  });

  it("批量校验 fail fast：先全部校验再执行——一个非法仅该个 isError，其余正常执行", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    const results = await dispatcher([
      { id: "a", tool: "get_entity", args: { id: "char-1" } }, // 缺 type → 非法
      { id: "b", tool: "exec_test_echo", args: { type: "character", id: "char-1" } },
      { id: "c", tool: "exec_test_echo", args: { type: "setting", id: "set-1" } },
    ]);
    expect(results.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(results[0].isError).toBe(true); // 仅 a 校验失败
    expect(results[1].isError).toBe(false); // b、c 不受影响正常执行
    expect(results[2].isError).toBe(false);
    expect(results[1].content).toBe('{"result":42}');
  });

  it("执行抛错（非 AbortedError）→ isError 结构化，不抛穿循环", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    const results = await dispatcher([
      { id: "a", tool: "exec_test_throw", args: { type: "character", id: "char-1" } },
    ]);
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ id: "a", ok: false, isError: true });
    expect(results[0].content).toContain("工具 exec_test_throw 执行失败");
    expect(results[0].content).toContain("boom");
    expect(results[0].content).toContain('"id":"char-1"');
  });

  it("AbortedError（run 抛出）→ 取消语义传播（reject，非 isError、不喂回）", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    await expect(
      dispatcher([{ id: "a", tool: "exec_test_abort", args: { type: "character", id: "char-1" } }]),
    ).rejects.toBeInstanceOf(AbortedError);
  });

  it("调度前 signal 已中止 → 抛 AbortedError，任何工具不执行（决策 16 ③）", async () => {
    const controller = new AbortController();
    controller.abort();
    const dispatcher = createToolDispatcher(makeCtx());
    await expect(
      dispatcher(
        [{ id: "a", tool: "exec_test_echo", args: { type: "character", id: "char-1" } }],
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(AbortedError);
    expect(capturedSignals).toHaveLength(0); // 一个工具都没执行
  });

  it("批量执行间隙取消 → 中止后续工具并传播取消（决策 16 ③）", async () => {
    const controller = new AbortController();
    selfAbortState.controller = controller;
    const dispatcher = createToolDispatcher(makeCtx());
    await expect(
      dispatcher(
        [
          { id: "a", tool: "exec_test_self_abort", args: { type: "character", id: "char-1" } },
          { id: "b", tool: "exec_test_echo", args: { type: "character", id: "char-1" } },
          { id: "c", tool: "exec_test_echo", args: { type: "character", id: "char-1" } },
        ],
        controller.signal,
      ),
    ).rejects.toBeInstanceOf(AbortedError);
    // 仅首个工具执行过（其 run 内中止 signal）；后续工具在间隙检查被拦截，取消按抛错路径传播
    expect(capturedSignals).toHaveLength(1);
    selfAbortState.controller = null;
  });

  it("工具抛普通 Error 但 signal 已中止 → 按取消传播（原样抛穿，非 isError 回填；B1 兜底）", async () => {
    const controller = new AbortController();
    selfAbortState.controller = controller;
    const dispatcher = createToolDispatcher(makeCtx());
    // 工具执行中用户取消但工具未检查 signal、抛普通 Error：catch 以 signal.aborted 双保险
    // 识别 → 原样抛穿（run.ts 侧按取消终止 aborted=true），而不是 isError 回填喂回 LLM
    await expect(
      dispatcher(
        [{ id: "a", tool: "exec_test_abort_then_throw", args: { type: "character", id: "char-1" } }],
        controller.signal,
      ),
    ).rejects.toThrow("普通错误");
    expect(capturedSignals).toHaveLength(1); // 工具确实执行过（非调度前入口检查拦截）
    selfAbortState.controller = null;
  });

  it("signal 透传到 run（决策 16 ③「run 调用传 signal」）", async () => {
    const controller = new AbortController();
    const dispatcher = createToolDispatcher(makeCtx());
    await dispatcher(
      [{ id: "a", tool: "exec_test_echo", args: { type: "character", id: "char-1" } }],
      controller.signal,
    );
    expect(capturedSignals[0]).toBe(controller.signal);
  });

  it("空调用列表 → 空结果（同序等长退化为空）", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    await expect(dispatcher([])).resolves.toEqual([]);
  });

  it("提案路径：propose_* 执行 → 完整 Proposal 入仓 + proposal 事件数据 + tool_result 严格无预览", async () => {
    const store = createProposalStore();
    const dispatcher = createToolDispatcher(makeCtx("proj-1"), { store });
    const results = await dispatcher([
      { id: "p1", tool: "propose_outline_node", args: { type: "chapter", title: "第一卷" } },
    ]);
    const r = results[0];
    expect(r.isError).toBe(false);
    expect(r.ok).toBe(true);
    // tool_result 严格 { proposal_id, summary }——无预览细节（tools.md「提案类」2026-08 修订）
    const parsed = JSON.parse(r.content) as { proposal_id: string; summary: string };
    expect(Object.keys(parsed).sort()).toEqual(["proposal_id", "summary"]);
    expect(parsed.proposal_id.startsWith("prop_")).toBe(true);
    // proposal 事件数据（S7.6 推 GUI）：proposal_id/type/preview{type,summary,args}
    expect(r.proposal?.proposal_id).toBe(parsed.proposal_id);
    expect(r.proposal?.type).toBe("propose_outline_node");
    expect(r.proposal?.preview).toEqual({
      type: "propose_outline_node",
      summary: parsed.summary,
      args: { type: "chapter", title: "第一卷" },
    });
    // 仓内可查（S7.5 confirm 取用）：完整 Proposal，id 与 tool_result / 事件一致
    const stored = store.get(parsed.proposal_id, "proj-1");
    expect(stored).not.toBeNull();
    expect(stored?.proposal_id).toBe(parsed.proposal_id);
    expect(stored?.project_id).toBe("proj-1");
    expect(stored?.type).toBe("propose_outline_node");
    expect(stored?.summary).toBe(parsed.summary);
    expect(stored?.args).toEqual({ type: "chapter", title: "第一卷" });
  });

  it("提案工具校验通过但执行抛错 → isError 结构化（如节点不存在）", async () => {
    const dispatcher = createToolDispatcher(makeCtx());
    const results = await dispatcher([
      { id: "d1", tool: "propose_delete_node", args: { node_id: "ch-missing" } },
    ]);
    expect(results[0]).toMatchObject({ id: "d1", tool: "propose_delete_node", ok: false, isError: true });
    expect(results[0].content).toContain("ch-missing"); // 错误信息含参数
  });

  it("PROPOSAL_BUILDERS 与 PROPOSAL_TOOLS 一一对应（新增提案工具须同步登记）", () => {
    expect(Object.keys(PROPOSAL_BUILDERS).sort()).toEqual([...PROPOSAL_TOOLS].sort());
  });

  it("缺省仓为 defaultProposalStore 单例（S7.5 confirm 与调度同仓消费）", async () => {
    defaultProposalStore.clear();
    try {
      const dispatcher = createToolDispatcher(makeCtx("proj-1"));
      await dispatcher([{ id: "s1", tool: "propose_outline_node", args: { type: "chapter", title: "第一卷" } }]);
      expect(defaultProposalStore.size()).toBe(1);
    } finally {
      defaultProposalStore.clear();
    }
  });
});

// ============ 提案内存仓（决策 14） ============

describe("提案内存仓（TTL / 上限 / 项目绑定 / clear）", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-03T12:00:00.000Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("set/get 往返 + 项目隔离（跨项目 get → null，防御 PROPOSAL_PROJECT_MISMATCH）", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    store.set(makeProposal("prop_2", "proj-2"));
    expect(store.get("prop_1", "proj-1")?.proposal_id).toBe("prop_1");
    expect(store.get("prop_1", "proj-2")).toBeNull(); // 跨项目 → null
    expect(store.get("prop_2", "proj-2")?.proposal_id).toBe("prop_2");
    expect(store.get("prop_2", "proj-1")).toBeNull();
    expect(store.get("prop_missing", "proj-1")).toBeNull();
    expect(store.size()).toBe(2);
  });

  it("TTL 过期：默认 10 分钟（假时钟推进）后 get 返回 null 并惰性清理", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1"));
    expect(store.get("prop_1", "proj-1")).not.toBeNull();
    vi.advanceTimersByTime(PROPOSAL_TTL_MS - 1);
    expect(store.get("prop_1", "proj-1")).not.toBeNull(); // 未到 TTL 仍可取
    vi.advanceTimersByTime(2);
    expect(store.get("prop_1", "proj-1")).toBeNull(); // 过期
    expect(store.size()).toBe(0); // 惰性清理已移除
  });

  it("TTL 覆盖选项 ttlMs 生效", () => {
    const store = createProposalStore({ ttlMs: 1_000 });
    store.set(makeProposal("prop_1"));
    vi.advanceTimersByTime(999);
    expect(store.get("prop_1", "proj-1")).not.toBeNull();
    vi.advanceTimersByTime(1);
    expect(store.get("prop_1", "proj-1")).toBeNull();
  });

  it("条数上限：超限淘汰 createdAt 最旧（set 前先清过期）", () => {
    const store = createProposalStore({ maxCount: 3 });
    store.set(makeProposal("prop_1", "proj-1", "2026-08-03T12:00:00.000Z"));
    store.set(makeProposal("prop_2", "proj-1", "2026-08-03T12:00:01.000Z"));
    store.set(makeProposal("prop_3", "proj-1", "2026-08-03T12:00:02.000Z"));
    store.set(makeProposal("prop_4", "proj-1", "2026-08-03T12:00:03.000Z"));
    expect(store.size()).toBe(3);
    expect(store.get("prop_1", "proj-1")).toBeNull(); // 最旧被淘汰
    expect(store.get("prop_2", "proj-1")).not.toBeNull();
    expect(store.get("prop_3", "proj-1")).not.toBeNull();
    expect(store.get("prop_4", "proj-1")).not.toBeNull();
  });

  it("过期条目不占上限：set 前 sweep 后仍可容纳新提案", () => {
    const store = createProposalStore({ maxCount: 2 });
    store.set(makeProposal("prop_1", "proj-1", "2026-08-03T11:50:00.000Z")); // 10 分钟前 → 已过期
    store.set(makeProposal("prop_2", "proj-1", "2026-08-03T12:00:00.000Z"));
    store.set(makeProposal("prop_3", "proj-1", "2026-08-03T12:00:01.000Z"));
    expect(store.size()).toBe(2);
    expect(store.get("prop_1", "proj-1")).toBeNull(); // 过期且已被 sweep 清理
    expect(store.get("prop_2", "proj-1")).not.toBeNull();
    expect(store.get("prop_3", "proj-1")).not.toBeNull();
  });

  it("clear() 清空全部项目提案（决策 14 修订：切换项目语义）", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    store.set(makeProposal("prop_2", "proj-2"));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get("prop_1", "proj-1")).toBeNull();
    expect(store.get("prop_2", "proj-2")).toBeNull();
  });

  it("peek 不过滤项目（S7.5 区分 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH 用），过期同样失效", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    expect(store.peek("prop_1")).not.toBeNull(); // 跨项目存在性仍可见
    expect(store.peek("prop_missing")).toBeNull();
    vi.advanceTimersByTime(PROPOSAL_TTL_MS + 1);
    expect(store.peek("prop_1")).toBeNull(); // 过期即视为不存在
  });

  it("默认常量：TTL 10 分钟 / 上限 200（导出供 S7.5 引用）", () => {
    expect(PROPOSAL_TTL_MS).toBe(10 * 60_000);
    expect(PROPOSAL_MAX_COUNT).toBe(200);
  });
});
