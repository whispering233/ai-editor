// pi 运行时：提案内存仓 + 提案 build 层入口 + sink 实现
//
// 提案（AI 写操作的确认对象）**仅存服务端内存**：TTL 10 分钟 + 条数上限 + 项目绑定 +
// 引用快照（确认时由 proposal 端点重校验，见 docs/design/30-agent-loop.md §2）。
//
// 本模块是提案仓与 `PROPOSAL_BUILDERS` 的**唯一实现**（提案端点与对话链路同仓消费）：
// - 仓：set/get/peek/remove/clear/size
// - build：15 个 propose_* 工具名 → 产出完整 Proposal 的构造函数
//   （工具的 run 只返回 `{ proposal_id, summary }`，完整对象必须重建——工具的返回值要省 token）
// - sink：pi 工具执行成功后的接线点——重建 Proposal 入仓 + 返回推给前端的载荷
//
// 架构边界：本包不依赖 db——`ToolContext`（db/outlineDir/projectId）由调用方注入并透传。

import {
  buildProposeAbandonHook,
  buildProposeAddDelta,
  buildProposeAddRelation,
  buildProposeAdvanceHook,
  buildProposeCreateEntity,
  buildProposeCreateHook,
  buildProposeCreateReference,
  buildProposeDeleteEntity,
  buildProposeDeleteNode,
  buildProposeMoveNode,
  buildProposeOutlineNode,
  buildProposeRemoveRelation,
  buildProposeReorderTimepoints,
  buildProposeResolveHook,
  buildProposeUpdateEntity,
  buildProposeUpdateHook,
  type Proposal,
  type ToolContext,
} from "@whispering233/ai-editor-tools";
import type { ProposalPayload, ProposalSink } from "./tools.js";

export type { Proposal };

// ============ 提案内存仓（仅内存、不落盘） ============

/** 提案 TTL（10 分钟；confirm/reject 引用——超期按不存在处理） */
export const PROPOSAL_TTL_MS = 10 * 60_000;

/**
 * 提案条数上限（超限淘汰 createdAt 最旧）。
 * 取 200 为数量级防御：正常会话一轮最多 15 个提案、挂卡不确认的残留按 TTL 自动过期，
 * 200 足以覆盖极端多轮场景且内存占用可忽略（防无限增长）。
 */
export const PROPOSAL_MAX_COUNT = 200;

/** 提案仓接口（confirm/reject 路由消费：get/peek；项目切换调 clear） */
export interface ProposalStore {
  /** 存入提案（TTL 从 createdAt 起算；先清过期、超限淘汰最旧） */
  set(proposal: Proposal): void;
  /**
   * 按 id + 项目取：不存在 / 过期 / **跨项目** → null。
   * 跨项目返回 null 即防御 PROPOSAL_PROJECT_MISMATCH 语义（提案绑定 project_id）。
   */
  get(proposalId: string, projectId: string): Proposal | null;
  /**
   * 仅按 id 取（不校验项目）：区分「404 PROPOSAL_NOT_FOUND」与「409 PROPOSAL_PROJECT_MISMATCH」用
   * ——get 返回 null 后 peek 仍可见 ⇒ 跨项目误操作。过期条目同样视为不存在（惰性清理）。
   */
  peek(proposalId: string): Proposal | null;
  /**
   * 按 id 移除单条（一次性消费：confirm/reject 终态后移除——瞬态交互对象，
   * 残留只会让重复 confirm 产生重复执行或反复 409）。
   * 与 clear 的区别：clear 清空全部（切换项目用），remove 只移除指定提案。
   */
  remove(proposalId: string): void;
  /** 清空全部项目提案（create/open/close 切换项目时调用） */
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
 * 过期策略：**惰性过期 + 按需清理**——get/peek 只清理命中的单条，set 前扫全仓清理；
 * 无定时器（定时器引入时钟耦合且小仓无必要，测试用假时钟直接断言）。
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
      if (entry.proposal.project_id !== projectId) return null; // 项目绑定
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

/** 默认提案仓单例（confirm/reject 与项目切换 clear 直接引用；测试用 createProposalStore 独立实例） */
export const defaultProposalStore: ProposalStore = createProposalStore();

// ============ 提案 build 层 ============

/**
 * 提案 build 层入口签名（args 已过 pi 的参数校验——preflight 返回的校验形态）。
 * run 层裁剪只返回 `{ proposal_id, summary }`，完整 Proposal 对象须经 build 层重建
 * （与 run 内部产出同源确定：同 ctx + 同 args 结果一致）。
 */
export type ProposalBuilder = (ctx: ToolContext, args: unknown) => Proposal;

/**
 * 16 个 propose_* 工具名 → build 层函数。
 * 运行时查表缺失（非提案工具）返回 undefined；完整性由测试断言覆盖
 * （Object.keys(PROPOSAL_BUILDERS) === PROPOSAL_TOOLS）。
 */
export const PROPOSAL_BUILDERS: Record<string, ProposalBuilder> = {
  propose_create_entity: (ctx, args) => buildProposeCreateEntity(ctx, args as never),
  propose_update_entity: (ctx, args) => buildProposeUpdateEntity(ctx, args as never),
  propose_delete_entity: (ctx, args) => buildProposeDeleteEntity(ctx, args as never),
  propose_add_relation: (ctx, args) => buildProposeAddRelation(ctx, args as never),
  propose_remove_relation: (ctx, args) => buildProposeRemoveRelation(ctx, args as never),
  propose_add_delta: (ctx, args) => buildProposeAddDelta(ctx, args as never),
  propose_outline_node: (ctx, args) => buildProposeOutlineNode(ctx, args as never),
  propose_move_node: (ctx, args) => buildProposeMoveNode(ctx, args as never),
  propose_delete_node: (ctx, args) => buildProposeDeleteNode(ctx, args as never),
  propose_create_hook: (ctx, args) => buildProposeCreateHook(ctx, args as never),
  propose_update_hook: (ctx, args) => buildProposeUpdateHook(ctx, args as never),
  propose_advance_hook: (ctx, args) => buildProposeAdvanceHook(ctx, args as never),
  propose_resolve_hook: (ctx, args) => buildProposeResolveHook(ctx, args as never),
  propose_abandon_hook: (ctx, args) => buildProposeAbandonHook(ctx, args as never),
  // G2（取代 F9 的 propose_reorder_events）
  propose_reorder_timepoints: (ctx, args) => buildProposeReorderTimepoints(ctx, args as never),
  propose_create_reference: (ctx, args) => buildProposeCreateReference(ctx, args as never),
};

// ============ 提案 sink（pi 工具执行 → 仓 + 前端载荷） ============

/** sink 选项 */
export interface CreateProposalSinkOptions {
  /** 提案仓（缺省 defaultProposalStore 单例——与 confirm/reject 同仓消费） */
  store?: ProposalStore;
}

/** 提案工具的 run 返回值（裁剪形态：只有 id 与一句话摘要） */
interface ProposalRunResult {
  proposal_id: string;
  summary: string;
}

/**
 * 构造提案 sink：pi 工具适配层在 PROPOSAL 工具执行成功后调用。
 * 1. 按工具名取 build 函数重建**完整 Proposal**（run 层返回值不含预览细节）
 * 2. `proposal_id` 以 run 返回值为准覆盖（build 每次生成新 id；三处必须同一 id：
 *    tool content / SSE details / 仓 key）
 * 3. 入仓（confirm/reject 取用），返回推给前端的载荷 `{ proposal_id, type, preview }`
 *
 * run 返回值形状不符（缺 proposal_id）→ 抛错：工具适配层会把它变成 error tool result
 * 喂回模型自纠（与「抛错即失败」契约一致），不得静默吞掉。
 */
export function createProposalSink(options: CreateProposalSinkOptions = {}): ProposalSink {
  const store = options.store ?? defaultProposalStore;
  return ({ toolName, params, result, toolContext }) => {
    const builder = PROPOSAL_BUILDERS[toolName];
    if (builder === undefined) return undefined; // 非提案工具（防御：调用方只在 PROPOSAL 工具调用）
    const runResult = parseProposalRunResult(toolName, result);
    const proposal: Proposal = { ...builder(toolContext, params), proposal_id: runResult.proposal_id };
    store.set(proposal);
    return toProposalPayload(proposal);
  };
}

/** 提案工具 run 返回值解析（缺 proposal_id 视为契约破坏，抛错让模型自纠） */
function parseProposalRunResult(toolName: string, result: unknown): ProposalRunResult {
  if (typeof result !== "object" || result === null) {
    throw new Error(`提案工具 ${toolName} 返回结果不符合（缺 proposal_id）`);
  }
  const record = result as { proposal_id?: unknown; summary?: unknown };
  if (typeof record.proposal_id !== "string") {
    throw new Error(`提案工具 ${toolName} 返回结果不符合（缺 proposal_id）`);
  }
  return {
    proposal_id: record.proposal_id,
    summary: typeof record.summary === "string" ? record.summary : "",
  };
}

/** 提案载荷生成（导出供测试与调用方复用；与 sink 内部同一逻辑）
 * preview 恒含 `summary`（结构化预览字段平铺其上）：模型可见的 tool content 与提案卡都需要一句话摘要，
 * 结构化 preview（如 propose_reorder_timepoints 的 `{changes}`）不得把它覆盖掉。 */
export function toProposalPayload(proposal: Proposal): ProposalPayload {
  return {
    proposal_id: proposal.proposal_id,
    type: proposal.type,
    preview: {
      summary: proposal.summary,
      ...(proposal.preview ?? { type: proposal.type, args: proposal.args }),
    },
  };
}
