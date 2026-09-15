// K3 提案仓 + sink 测试
//
// 覆盖面：
// - 仓：往返 / 项目绑定 / 假时钟 TTL / 条数上限淘汰最旧 / peek 不过滤项目 / remove / clear
// - sink：build 层重建完整 Proposal 入仓、proposal_id 以 run 返回值为准覆盖、
//   preview 缺省回落 `{type, summary, args}`、结构化 preview 原样透传、
//   run 返回值形状不符 → 抛错（由工具适配层转 error tool result）、非提案工具 → undefined
//
// 仓的断言从旧 executor.test.ts 原样搬运（行为不变），sink 为 K3 新增接线。

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TOOL_PERMISSION } from "@whispering233/ai-editor-shared";
import { registerTool, getEntityArgsSchema, type Proposal, type ToolContext } from "@whispering233/ai-editor-tools";
import {
  PROPOSAL_BUILDERS,
  PROPOSAL_MAX_COUNT,
  PROPOSAL_TTL_MS,
  createProposalSink,
  createProposalStore,
  defaultProposalStore,
} from "./proposals.js";

/** 最小 ToolContext（agent 不依赖 db——只透传，测试不触达 db/文件） */
function makeCtx(projectId = "proj-test"): ToolContext {
  return { db: undefined as never, outlineDir: "", projectId };
}

/** 构造 Proposal（仓直测用；createdAt 缺省取当前假时钟时刻） */
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

// ============ 提案内存仓（行为与旧 executor.test.ts 一致） ============

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

  it("remove 只移除指定提案（一次性消费语义）", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    store.set(makeProposal("prop_2", "proj-1"));
    store.remove("prop_1");
    expect(store.get("prop_1", "proj-1")).toBeNull();
    expect(store.get("prop_2", "proj-1")).not.toBeNull();
    expect(store.size()).toBe(1);
  });

  it("clear() 清空全部项目提案（切换项目语义）", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    store.set(makeProposal("prop_2", "proj-2"));
    store.clear();
    expect(store.size()).toBe(0);
    expect(store.get("prop_1", "proj-1")).toBeNull();
    expect(store.get("prop_2", "proj-2")).toBeNull();
  });

  it("peek 不过滤项目（区分 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH 用），过期同样失效", () => {
    const store = createProposalStore();
    store.set(makeProposal("prop_1", "proj-1"));
    expect(store.peek("prop_1")).not.toBeNull(); // 跨项目存在性仍可见
    expect(store.peek("prop_missing")).toBeNull();
    vi.advanceTimersByTime(PROPOSAL_TTL_MS + 1);
    expect(store.peek("prop_1")).toBeNull(); // 过期即视为不存在
  });

  it("默认常量：TTL 10 分钟 / 上限 200", () => {
    expect(PROPOSAL_TTL_MS).toBe(10 * 60_000);
    expect(PROPOSAL_MAX_COUNT).toBe(200);
  });
});

// ============ 提案 sink（pi 工具执行 → 仓 + 前端载荷） ============

describe("createProposalSink", () => {
  it("重建完整 Proposal 入仓，proposal_id 以 run 返回值为准，preview 缺省回落 {type,summary,args}", () => {
    const store = createProposalStore();
    const sink = createProposalSink({ store });
    const payload = sink({
      toolName: "propose_outline_node",
      toolCallId: "call-1",
      params: { type: "volume", title: "第一卷" },
      result: { proposal_id: "prop_run", summary: "新建章节「第一卷」" },
      toolContext: makeCtx("proj-1"),
    });

    expect(payload?.proposal_id).toBe("prop_run");
    expect(payload?.type).toBe("propose_outline_node");

    const stored = store.get("prop_run", "proj-1");
    expect(stored).not.toBeNull();
    expect(stored?.proposal_id).toBe("prop_run");
    expect(stored?.project_id).toBe("proj-1");
    expect(stored?.type).toBe("propose_outline_node");
    expect(stored?.args).toEqual({ type: "volume", title: "第一卷" });

    // preview 缺省回落：`{type, summary, args}`，其中 summary 取 **build 层**的措辞
    // （run 返回值里的 summary 只进模型可见的 tool content，见 tools.ts 的 ack 文案）
    expect(payload?.preview).toEqual({
      type: "propose_outline_node",
      summary: stored?.summary,
      args: stored?.args,
    });
  });

  it("结构化 preview 保留原字段并补一句话摘要（不回落默认形态）", () => {
    const store = createProposalStore();
    const sink = createProposalSink({ store });
    const toolName = "k3_test_preview_proposal";
    const preview = { changes: ["「玉佩来历」从第 3 位移到第 1 位"] };
    PROPOSAL_BUILDERS[toolName] = (ctx, args) => ({
      ...makeProposal("prop_raw", ctx.projectId),
      type: toolName,
      args: args as Record<string, unknown>,
      summary: "重排时间点",
      preview,
    });
    try {
      const payload = sink({
        toolName,
        toolCallId: "call-2",
        params: { timepoint_ids: ["tp-1", "tp-2"] },
        result: { proposal_id: "prop_structured", summary: "重排时间点" },
        toolContext: makeCtx("proj-1"),
      });
      // preview 恒含 summary（模型可见 tool content 与提案卡都要用），结构化字段平铺其上
      expect(payload).toEqual({
        proposal_id: "prop_structured",
        type: toolName,
        preview: { summary: "重排时间点", ...preview },
      });
      expect(store.get("prop_structured", "proj-1")?.preview).toEqual(preview);
    } finally {
      delete PROPOSAL_BUILDERS[toolName];
    }
  });

  it("未接 store 时写 defaultProposalStore 单例（与 confirm/reject 同仓消费）", () => {
    defaultProposalStore.clear();
    try {
      const sink = createProposalSink();
      const payload = sink({
        toolName: "propose_outline_node",
        toolCallId: "call-3",
        params: { type: "volume", title: "开场" },
        result: { proposal_id: "prop_singleton", summary: "新建章节" },
        toolContext: makeCtx("proj-1"),
      });
      expect(payload?.proposal_id).toBe("prop_singleton");
      expect(defaultProposalStore.get("prop_singleton", "proj-1")).not.toBeNull();
    } finally {
      defaultProposalStore.clear();
    }
  });

  it("run 返回值缺 proposal_id → 抛错（工具适配层转 error tool result 喂回模型）", () => {
    const sink = createProposalSink({ store: createProposalStore() });
    expect(() =>
      sink({
        toolName: "propose_outline_node",
        toolCallId: "call-3",
        params: { type: "chapter", title: "x" },
        result: { summary: "缺 id" },
        toolContext: makeCtx(),
      }),
    ).toThrow(/缺 proposal_id/);
    expect(() =>
      sink({
        toolName: "propose_outline_node",
        toolCallId: "call-4",
        params: {},
        result: null,
        toolContext: makeCtx(),
      }),
    ).toThrow(/缺 proposal_id/);
  });

  it("非提案工具名 → undefined（无 build 层入口，不误建提案）", () => {
    const store = createProposalStore();
    const sink = createProposalSink({ store });
    expect(
      sink({
        toolName: "get_outline",
        toolCallId: "call-5",
        params: {},
        result: { proposal_id: "prop_x", summary: "x" },
        toolContext: makeCtx(),
      }),
    ).toBeUndefined();
    expect(store.size()).toBe(0);
  });

  it("PROPOSAL_BUILDERS 覆盖 shared 的 PROPOSAL_TOOLS（新增提案工具须同步登记）", async () => {
    const { PROPOSAL_TOOLS } = await import("@whispering233/ai-editor-shared");
    expect(Object.keys(PROPOSAL_BUILDERS).sort()).toEqual([...PROPOSAL_TOOLS].sort());
  });
});

// ============ 与真实工具组合（sink 走真实 build 函数） ============

describe("sink × 真实提案工具", () => {
  // registry 无注销 API：测试工具用唯一名注册一次（模块级）
  const PROPOSAL_TOOL_NAME = "k3_test_propose";
  registerTool({
    name: PROPOSAL_TOOL_NAME,
    description: "K3 测试用提案工具（复用 build 层，验证 sink 与真实工具的协作）",
    parameters: getEntityArgsSchema,
    permission: TOOL_PERMISSION.PROPOSAL,
    run: () => ({ proposal_id: "prop_k3", summary: "K3 测试提案" }),
  });

  it("sink 只认 build 表里的工具名（测试工具未登记 → undefined，不静默入仓）", () => {
    const store = createProposalStore();
    const sink = createProposalSink({ store });
    const payload = sink({
      toolName: PROPOSAL_TOOL_NAME,
      toolCallId: "call-6",
      params: { type: "character", id: "char-1" },
      result: { proposal_id: "prop_k3", summary: "K3 测试提案" },
      toolContext: makeCtx(),
    });
    expect(payload).toBeUndefined();
    expect(store.size()).toBe(0);
  });
});
