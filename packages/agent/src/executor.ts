// @whispering233/ai-editor-agent 工具调度器 + 提案内存仓（S7.4）
// 契约来源：
//   - doc/design/tasks.md S7.4（调度 query/analysis/proposal；提案仓 TTL 10 分钟 + 条数上限 +
//     project_id 绑定、切换项目清空；批量 tool_call 先全部校验再执行、错误统一结构化回填、
//     执行中检查取消 signal）
//   - doc/api/tools.md「工具执行契约」（抛错即失败不抛穿循环、批量先校验 fail fast 再逐个执行、
//     结果按 tool_call_id 一一回填、截断显式告知——截断由 S7.2 上下文裁剪承担，本层不截断）
//     与「提案类」返回语义（tool_result 仅 { proposal_id, summary }，完整预览经 SSE proposal
//     事件推送 GUI）
//   - doc/design/decisions.md 决策 14（提案仅内存：TTL/上限/项目绑定/切换清空）、
//     决策 15（工具失败结构化喂回自纠：工具名+参数+错误信息）、
//     决策 16 ③（工具执行中检查取消信号——AbortedError 按取消语义传播，不喂回、不视为工具失败）
//   - run.ts（S7.3）ToolDispatcher 契约：同序等长、不抛错（失败编码进 isError）、proposal 透传；
//     AbortedError 经**抛错路径**传播（本文件抛、run.ts dispatcher catch 识别后按用户取消终止）
//
// 架构边界：本包**不依赖 db**——ToolContext（db/outlineDir/projectId）由 S7.6 server 层注入
// （createToolDispatcher 闭包捕获），这里只透传给工具 run/build；agent 侧不触碰 db 类型。

import type { AbortSignalLike } from "@whispering233/ai-editor-llm";
import type {
  ProposeAbandonHookArgs,
  ProposeAddDeltaArgs,
  ProposeAddRelationArgs,
  ProposeAdvanceHookArgs,
  ProposeCreateEntityArgs,
  ProposeCreateHookArgs,
  ProposeDeleteEntityArgs,
  ProposeDeleteNodeArgs,
  ProposeMoveNodeArgs,
  ProposeOutlineNodeArgs,
  ProposeRemoveRelationArgs,
  ProposeReorderEventsArgs,
  ProposeResolveHookArgs,
  ProposeUpdateEntityArgs,
  ProposeUpdateHookArgs,
} from "@whispering233/ai-editor-shared";
import {
  AbortedError,
  buildProposeAbandonHook,
  buildProposeAddDelta,
  buildProposeAddRelation,
  buildProposeAdvanceHook,
  buildProposeCreateEntity,
  buildProposeCreateHook,
  buildProposeDeleteEntity,
  buildProposeDeleteNode,
  buildProposeMoveNode,
  buildProposeOutlineNode,
  buildProposeRemoveRelation,
  buildProposeReorderEvents,
  buildProposeResolveHook,
  buildProposeUpdateEntity,
  buildProposeUpdateHook,
  getTool,
  throwIfAborted,
  type Proposal,
  type ToolContext,
  type ToolDefinition,
} from "@whispering233/ai-editor-tools";
import type { DispatchResult, DispatchToolCall, ToolDispatcher } from "./run.js";

// ============ 提案内存仓（决策 14：仅内存、不落盘） ============

/** 提案 TTL（决策 14：10 分钟；S7.5 confirm/reject 引用——超期按不存在处理） */
export const PROPOSAL_TTL_MS = 10 * 60_000;

/**
 * 提案条数上限（决策 14：超限淘汰 createdAt 最旧）。
 * 决策原文未定数——取 200 为数量级防御：正常会话一轮最多 15 个提案、挂卡不确认的
 * 残留按 TTL 自动过期，200 足以覆盖极端多轮场景且内存占用可忽略（防无限增长）。
 */
export const PROPOSAL_MAX_COUNT = 200;

/** 提案仓接口（S7.5 路由消费：confirm/reject 经 get/peek；S7.6 切换项目调 clear） */
export interface ProposalStore {
  /** 存入提案（TTL 从 createdAt 起算；先清过期、超限淘汰最旧） */
  set(proposal: Proposal): void;
  /**
   * 按 id + 项目取：不存在 / 过期 / **跨项目** → null。
   * 跨项目返回 null 即防御 PROPOSAL_PROJECT_MISMATCH 语义（决策 14 修订——
   * 提案绑定 project_id，确认时校验与当前项目一致）。
   */
  get(proposalId: string, projectId: string): Proposal | null;
  /**
   * 仅按 id 取（不校验项目）：S7.5 区分「404 PROPOSAL_NOT_FOUND」与
   * 「409 PROPOSAL_PROJECT_MISMATCH」用——get 返回 null 后 peek 仍可见 ⇒ 跨项目误操作。
   * 过期条目同样视为不存在（惰性清理）。
   */
  peek(proposalId: string): Proposal | null;
  /**
   * 按 id 移除单条（S7.5 一次性消费：confirm/reject 终态后移除——决策 14 瞬态交互对象，
   * 确认/拒绝动作即消费，残留只会让重复 confirm 产生重复执行或反复 409）。
   * 与 clear() 的区别：clear 清空全部（S7.6 切换项目用），remove 只移除指定提案。
   */
  remove(proposalId: string): void;
  /** 清空全部项目提案（决策 14 修订：create/open/close 切换项目时由 S7.6 调用） */
  clear(): void;
  /** 当前仓内提案数（测试/诊断） */
  size(): number;
}

/** createProposalStore 选项（测试覆盖 TTL/上限用；缺省取导出的常量） */
export interface ProposalStoreOptions {
  /** TTL 覆盖 ms（缺省 PROPOSAL_TTL_MS） */
  ttlMs?: number;
  /** 条数上限覆盖（缺省 PROPOSAL_MAX_COUNT） */
  maxCount?: number;
}

/**
 * 创建提案仓实例。
 * 过期策略：**惰性过期 + 按需清理**（决策 14「超期自动清除」落地）——get/peek 只清理命中的
 * 单条，set 前扫全仓清理；无定时器（定时器引入时钟耦合且小仓无必要，测试用假时钟直接断言）。
 * 淘汰策略：条数超限时淘汰 createdAt **最旧**的提案（sweep 过期后仍满则循环淘汰最旧）。
 */
export function createProposalStore(options: ProposalStoreOptions = {}): ProposalStore {
  const ttlMs = options.ttlMs ?? PROPOSAL_TTL_MS;
  const maxCount = options.maxCount ?? PROPOSAL_MAX_COUNT;
  /** 仓内条目：proposal + 过期时刻（set 时按 createdAt 预计算；createdAt 不可解析按立即过期防御） */
  const entries = new Map<string, { proposal: Proposal; expiresAt: number }>();
  const isExpired = (entry: { proposal: Proposal; expiresAt: number }): boolean => Date.now() >= entry.expiresAt;
  const sweepExpired = (): void => {
    for (const [id, entry] of entries) {
      if (isExpired(entry)) entries.delete(id);
    }
  };
  return {
    set(proposal) {
      sweepExpired();
      const createdAtMs = Date.parse(proposal.createdAt);
      entries.set(proposal.proposal_id, {
        proposal,
        expiresAt: Number.isNaN(createdAtMs) ? 0 : createdAtMs + ttlMs,
      });
      // 条数上限：循环淘汰最旧直到回到上限内（createdAt 同值取先插入者——迭代序即插入序）
      while (entries.size > maxCount) {
        let oldestId: string | null = null;
        let oldestTime = Number.POSITIVE_INFINITY;
        for (const [id, entry] of entries) {
          const t = Date.parse(entry.proposal.createdAt);
          if (t < oldestTime) {
            oldestTime = t;
            oldestId = id;
          }
        }
        if (oldestId === null) break; // 防御：理论不可达（size > 0 必有最旧）
        entries.delete(oldestId);
      }
    },
    get(proposalId, projectId) {
      const entry = entries.get(proposalId);
      if (entry === undefined) return null;
      if (isExpired(entry)) {
        entries.delete(proposalId); // 惰性过期清理
        return null;
      }
      if (entry.proposal.project_id !== projectId) return null; // 项目绑定（决策 14 修订）
      return entry.proposal;
    },
    peek(proposalId) {
      const entry = entries.get(proposalId);
      if (entry === undefined) return null;
      if (isExpired(entry)) {
        entries.delete(proposalId);
        return null;
      }
      return entry.proposal;
    },
    remove(proposalId) {
      entries.delete(proposalId);
    },
    clear() {
      entries.clear();
    },
    size() {
      return entries.size;
    },
  };
}

/** 默认提案仓单例（S7.5 confirm/reject 与 S7.6 切换项目 clear 直接引用；测试用 createProposalStore 独立实例） */
export const defaultProposalStore: ProposalStore = createProposalStore();

// ============ 工具调度器（ToolDispatcher 真实现，run.ts 契约） ============

/**
 * 提案 build 层入口签名（args 已过 argsSchema 校验——执行前 safeParse 的 parsed.data）。
 * run 层裁剪只返回 { proposal_id, summary }（tools.md「提案类」2026-08 修订），
 * 完整 Proposal 对象须经 build 层重建（与 run 内部产出同源确定：同 ctx + 同 args 结果一致）。
 */
type ProposalBuilder = (ctx: ToolContext, args: unknown) => Proposal;

/**
 * 15 个 propose_* 工具名 → build 层函数。
 * 运行时查表缺失（非 propose 工具）走普通结果路径；完整性由测试断言覆盖
 * （Object.keys(PROPOSAL_BUILDERS) === PROPOSAL_TOOLS）——S6.6 后续新增提案工具须同步登记。
 * 导出仅为完整性测试断言；业务侧经 createToolDispatcher 间接使用。
 */
export const PROPOSAL_BUILDERS: Record<string, ProposalBuilder> = {
  propose_create_entity: (ctx, args) => buildProposeCreateEntity(ctx, args as ProposeCreateEntityArgs),
  propose_update_entity: (ctx, args) => buildProposeUpdateEntity(ctx, args as ProposeUpdateEntityArgs),
  propose_delete_entity: (ctx, args) => buildProposeDeleteEntity(ctx, args as ProposeDeleteEntityArgs),
  propose_add_relation: (ctx, args) => buildProposeAddRelation(ctx, args as ProposeAddRelationArgs),
  propose_remove_relation: (ctx, args) => buildProposeRemoveRelation(ctx, args as ProposeRemoveRelationArgs),
  propose_add_delta: (ctx, args) => buildProposeAddDelta(ctx, args as ProposeAddDeltaArgs),
  propose_outline_node: (ctx, args) => buildProposeOutlineNode(ctx, args as ProposeOutlineNodeArgs),
  propose_move_node: (ctx, args) => buildProposeMoveNode(ctx, args as ProposeMoveNodeArgs),
  propose_delete_node: (ctx, args) => buildProposeDeleteNode(ctx, args as ProposeDeleteNodeArgs),
  propose_create_hook: (ctx, args) => buildProposeCreateHook(ctx, args as ProposeCreateHookArgs),
  propose_update_hook: (ctx, args) => buildProposeUpdateHook(ctx, args as ProposeUpdateHookArgs),
  propose_advance_hook: (ctx, args) => buildProposeAdvanceHook(ctx, args as ProposeAdvanceHookArgs),
  propose_resolve_hook: (ctx, args) => buildProposeResolveHook(ctx, args as ProposeResolveHookArgs),
  propose_abandon_hook: (ctx, args) => buildProposeAbandonHook(ctx, args as ProposeAbandonHookArgs),
  propose_reorder_events: (ctx, args) => buildProposeReorderEvents(ctx, args as ProposeReorderEventsArgs), // F9
};

/** createToolDispatcher 选项 */
export interface CreateToolDispatcherOptions {
  /** 提案仓（缺省 defaultProposalStore 单例——S7.5 confirm/reject 与调度同仓消费） */
  store?: ProposalStore;
}

/**
 * 创建工具调度器（run.ts ToolDispatcher 真实现）：
 * 1. **批量校验 fail fast**（tools.md「工具执行契约」）：先全部 getTool(name).argsSchema
 *    safeParse——工具不存在 / 参数非法 → 该调用合成 isError 结果（**不中断其他调用**，
 *    「fail fast」指校验先于执行，错误编码进 isError 喂回 LLM 自纠）；全部校验完再逐个执行
 * 2. **执行中检查 signal**（决策 16 ③）：调度前 + 每个工具执行前 throwIfAborted，run 调用
 *    透传 signal（长分析工具内部周期检查）；命中取消抛 AbortedError **按取消语义传播**
 *    （原样抛穿，run.ts 识别后按用户取消终止——不喂回、不视为工具失败）
 * 3. 工具执行抛错（非 AbortedError）→ 统一 isError 结构化（工具名+参数+错误信息，决策 15）
 * 4. propose_* 执行成功 → build 层重建完整 Proposal 入仓 + 构造 preview（S7.6 推 GUI）→
 *    DispatchResult.proposal 透传 run.ts（proposal 事件在 tool_result 后、循环继续前——run.ts 保证）
 */
export function createToolDispatcher(ctx: ToolContext, options: CreateToolDispatcherOptions = {}): ToolDispatcher {
  const store = options.store ?? defaultProposalStore;
  return async (calls, signal): Promise<DispatchResult[]> => {
    // 调度前取消检查（决策 16 ③）：已取消则一个工具都不执行，直接按取消传播
    throwIfAborted(toAbortSignal(signal));

    // ---- 1. 批量校验 fail fast：全部先校验，再逐个执行 ----
    const plans = calls.map((call): Plan => {
      const def = getTool(call.tool);
      if (def === undefined) {
        // 工具不存在：执行类工具不注册不暴露（tools.md「核心设计原则」——AI 只能提案不能直接写）
        return {
          call,
          error: `工具不存在或不可调用：${call.tool}（AI 只能调用已注册的查询/分析/提案工具，执行类工具不暴露）`,
        };
      }
      const parsed = def.argsSchema.safeParse(call.args);
      if (!parsed.success) {
        return { call, error: formatValidationError(call, parsed.error) };
      }
      return { call, def, parsed: parsed.data };
    });

    // ---- 2. 逐个执行（结果按输入顺序一一回填，同序等长——run.ts 契约） ----
    const results: DispatchResult[] = [];
    for (const plan of plans) {
      // 批量执行间隙被取消（决策 16 ③）：立即中止后续工具并传播取消
      throwIfAborted(toAbortSignal(signal));
      const def = plan.def;
      if (def === undefined) {
        // 校验失败槽位：isError 直接回填（不执行——校验即失败，喂回 LLM 自纠）
        results.push({
          id: plan.call.id,
          tool: plan.call.tool,
          ok: false,
          isError: true,
          content: plan.error ?? "工具参数校验失败",
        });
        continue;
      }
      try {
        const raw = await def.run(ctx, plan.parsed, toAbortSignal(signal));
        const builder = PROPOSAL_BUILDERS[plan.call.tool];
        if (builder === undefined) {
          // 普通工具（query/analysis）：结果序列化为 content 回填
          results.push({
            id: plan.call.id,
            tool: plan.call.tool,
            ok: true,
            isError: false,
            content: serializeToolResult(raw),
          });
          continue;
        }
        // ---- 提案路径（propose_*，决策 14 + tools.md「提案类」） ----
        // run 层裁剪只返回 { proposal_id, summary }；完整 Proposal 经 build 层重建入仓——
        // proposal_id 以 run 返回为准覆盖（build 每次生成新 id），保证
        // tool_result / proposal 事件 / 仓 key 三处同一 id（S7.5 confirm 按事件 id 取仓）
        const runResult = raw as Partial<{ proposal_id: unknown; summary: unknown }> | null;
        if (
          runResult === null ||
          typeof runResult !== "object" ||
          typeof runResult.proposal_id !== "string"
        ) {
          throw new Error(`提案工具 ${plan.call.tool} 返回结果不符合契约（缺 proposal_id）`);
        }
        const summary = typeof runResult.summary === "string" ? runResult.summary : "";
        const proposal: Proposal = { ...builder(ctx, plan.parsed), proposal_id: runResult.proposal_id };
        store.set(proposal); // 供 S7.5 confirm/reject 取用
        results.push({
          id: plan.call.id,
          tool: plan.call.tool,
          ok: true,
          isError: false,
          // tool_result 严格 { proposal_id, summary }——不含预览细节（避免 LLM 误以为提案已生效而重复提案）
          content: JSON.stringify({ proposal_id: proposal.proposal_id, summary }),
          // preview 由 S7.6 经 SSE proposal 事件推 GUI（完整预览不走 tool_result）；
          // F9 起 build 可携带结构化 preview（如 propose_reorder_events 的 { changes }）——
          // 有则透传，无则回退默认 { type, summary, args }（既有提案工具行为不变）
          proposal: {
            proposal_id: proposal.proposal_id,
            type: proposal.type,
            preview: proposal.preview ?? { type: proposal.type, summary: proposal.summary, args: proposal.args },
          },
        });
      } catch (err) {
        // 取消语义传播（决策 16）：AbortedError 不喂回、不计失败轮——原样抛出，
        // run.ts dispatcher catch 识别后按用户取消终止（aborted=true，不重试）。
        // signal 已置位时一律按取消传播（双保险，与 run.ts catch 对称）：覆盖「工具未检查
        // signal 即抛普通 Error」的取消竞态，以及跨包副本 AbortedError 的 instanceof 失效场景
        // （工具包内抛出的 AbortedError 若经打包/深拷贝丢失原型链，仍可按 signal 状态识别）
        if (err instanceof AbortedError || signal?.aborted === true) throw err;
        // 其余抛错：结构化 isError 回填（决策 15：工具名 + 参数 + 错误信息，喂回 LLM 自纠）
        results.push({
          id: plan.call.id,
          tool: plan.call.tool,
          ok: false,
          isError: true,
          content: formatRunError(plan.call, err),
        });
      }
    }
    return results;
  };
}

// ============ 内部辅助 ============

/** 单个调用调度计划（校验阶段产物：通过 → def+parsed；失败 → error） */
interface Plan {
  call: DispatchToolCall;
  def?: ToolDefinition;
  /** safeParse 通过后的参数（zod ZodTypeAny 输出形态，run/build 各自按 schema 约束使用） */
  parsed?: unknown;
  /** 校验失败的结构化错误（isError content） */
  error?: string;
}

/** zod 校验错误的最小结构（避免 agent 直接依赖 zod——类型经 tools → shared 依赖链传递解析） */
interface ValidationIssueLike {
  path?: (string | number | symbol)[];
  message?: string;
}

/**
 * AbortSignalLike → 工具层 AbortSignal（同一运行时对象；llm 包为免 DOM lib 依赖只声明了
 * 最小结构，工具 run 签名用 DOM 类型——结构兼容，仅类型适配）
 */
function toAbortSignal(signal?: AbortSignalLike): AbortSignal | undefined {
  return signal as AbortSignal | undefined;
}

/** 参数校验失败结构化回填（工具名 + 校验问题明细 + 参数，喂回 LLM 修正后重试） */
function formatValidationError(call: DispatchToolCall, error: { issues?: readonly ValidationIssueLike[] }): string {
  const detail = (error.issues ?? [])
    .map((issue) => `${(issue.path ?? []).map(String).join(".") || "(根)"}：${issue.message ?? "未知错误"}`)
    .join("；");
  return `工具 ${call.tool} 参数校验失败（未执行，请修正参数后重试）：${detail}；参数：${JSON.stringify(call.args)}`;
}

/** 工具执行失败结构化回填（决策 15：工具名 + 参数 + 错误信息，喂回 LLM 自纠） */
function formatRunError(call: DispatchToolCall, err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return `工具 ${call.tool} 执行失败：${message}；参数：${JSON.stringify(call.args)}`;
}

/** 工具结果序列化（content 恒为字符串）：字符串原样；对象 JSON；undefined/不可序列化兜底 */
function serializeToolResult(raw: unknown): string {
  if (typeof raw === "string") return raw;
  if (raw === undefined) return "undefined";
  const json = JSON.stringify(raw);
  return json === undefined ? String(raw) : json;
}
