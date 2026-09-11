// @whispering233/ai-editor-agent 旧内核工具调度器（过渡期保留）
//
// 提案仓与 PROPOSAL_BUILDERS 的唯一实现已移入 runtime/proposals.ts，本文件只再导出；
// 旧 chat 路由仍用 createToolDispatcher，K4 切换后随 K7 删除本文件。
//
// 架构边界：本包**不依赖 db**——ToolContext（db/outlineDir/projectId）由 server 层注入
// （createToolDispatcher 闭包捕获），这里只透传给工具 run/build；agent 侧不触碰 db 类型。

import type { AbortSignalLike } from "@whispering233/ai-editor-llm";
import {
  AbortedError,
  getTool,
  throwIfAborted,
  validateToolArgs,
  type ToolContext,
  type ToolDefinition,
} from "@whispering233/ai-editor-tools";
import {
  PROPOSAL_BUILDERS,
  defaultProposalStore,
  type Proposal,
  type ProposalStore,
} from "./runtime/proposals.js";
import type { DispatchResult, DispatchToolCall, ToolDispatcher } from "./run.js";

// ============ 提案仓与 build 层（唯一实现已移入 runtime/proposals.ts） ============
//
// 旧内核过渡期保留：旧 chat 路由仍引用 createToolDispatcher（K4 切换后随 K7 删除）。
// 提案仓与 PROPOSAL_BUILDERS 只再导出、不在本文件重复实现——两份实现必然漂移。

export {
  PROPOSAL_BUILDERS,
  PROPOSAL_MAX_COUNT,
  PROPOSAL_TTL_MS,
  createProposalStore,
  defaultProposalStore,
} from "./runtime/proposals.js";
export type { ProposalStore, ProposalStoreOptions } from "./runtime/proposals.js";

// ============ 工具调度器（ToolDispatcher 真实现，run.ts） ============

/** createToolDispatcher 选项 */
export interface CreateToolDispatcherOptions {
 /** 提案仓（缺省 defaultProposalStore 单例——S7.5 confirm/reject 与调度同仓消费） */
  store?: ProposalStore;
}

/**
 * 创建工具调度器（run.ts ToolDispatcher 真实现）：
 * 1. **批量校验 fail fast**（「工具执行」）：先全部 validateToolArgs（TypeBox schema）
 * ——工具不存在 / 参数非法 → 该调用合成 isError 结果（**不中断其他调用**，
 * 「fail fast」指校验先于执行，错误编码进 isError 喂回 LLM 自纠）；全部校验完再逐个执行
 * 2. **执行中检查 signal**：调度前 + 每个工具执行前 throwIfAborted，run 调用
 * 透传 signal（长分析工具内部周期检查）；命中取消抛 AbortedError **按取消语义传播**
 * （原样抛穿，run.ts 识别后按用户取消终止——不喂回、不视为工具失败）
 * 3. 工具执行抛错（非 AbortedError）→ 统一 isError 结构化（工具名+参数+错误信息）
 * 4. propose_* 执行成功 → build 层重建完整 Proposal 入仓 + 构造 preview（S7.6 推 GUI）→
 * DispatchResult.proposal 透传 run.ts（proposal 事件在 tool_result 后、循环继续前——run.ts 保证）
 */
export function createToolDispatcher(ctx: ToolContext, options: CreateToolDispatcherOptions = {}): ToolDispatcher {
  const store = options.store ?? defaultProposalStore;
  return async (calls, signal): Promise<DispatchResult[]> => {
 // 调度前取消检查：已取消则一个工具都不执行，直接按取消传播
    throwIfAborted(toAbortSignal(signal));

 // ---- 1. 批量校验 fail fast：全部先校验，再逐个执行 ----
    const plans = calls.map((call): Plan => {
      const def = getTool(call.tool);
      if (def === undefined) {
 // 工具不存在：执行类工具不注册不暴露（「核心设计原则」——AI 只能提案不能直接写）
        return {
          call,
          error: `工具不存在或不可调用：${call.tool}（AI 只能调用已注册的查询/分析/提案工具，执行类工具不暴露）`,
        };
      }
      try {
        return { call, def, parsed: validateToolArgs(def, call.args) };
      } catch (err) {
        // 校验失败：不执行（喂回 LLM 自纠）；错误消息由 pi-ai 校验器给出（工具名 + 字段路径 + 原始参数）
        return { call, error: formatValidationError(call, err) };
      }
    });

 // ---- 2. 逐个执行（结果按输入顺序一一回填，同序等长——run.ts） ----
    const results: DispatchResult[] = [];
    for (const plan of plans) {
 // 批量执行间隙被取消：立即中止后续工具并传播取消
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
 // ---- 提案路径（propose_*，「提案类」） ----
 // run 层裁剪只返回 { proposal_id, summary }；完整 Proposal 经 build 层重建入仓——
 // proposal_id 以 run 返回为准覆盖（build 每次生成新 id），保证
 // tool_result / proposal 事件 / 仓 key 三处同一 id（S7.5 confirm 按事件 id 取仓）
        const runResult = raw as Partial<{ proposal_id: unknown; summary: unknown }> | null;
        if (
          runResult === null ||
          typeof runResult !== "object" ||
          typeof runResult.proposal_id !== "string"
        ) {
          throw new Error(`提案工具 ${plan.call.tool} 返回结果不符合（缺 proposal_id）`);
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
 // F9/G2 起 build 可携带结构化 preview（如 propose_reorder_timepoints 的 { changes }）——
 // 有则透传，无则回退默认 { type, summary, args }（既有提案工具行为不变）
          proposal: {
            proposal_id: proposal.proposal_id,
            type: proposal.type,
            preview: proposal.preview ?? { type: proposal.type, summary: proposal.summary, args: proposal.args },
          },
        });
      } catch (err) {
 // 取消语义传播：AbortedError 不喂回、不计失败轮——原样抛出，
 // run.ts dispatcher catch 识别后按用户取消终止（aborted=true，不重试）。
 // signal 已置位时一律按取消传播（双保险，与 run.ts catch 对称）：覆盖「工具未检查
 // signal 即抛普通 Error」的取消竞态，以及跨包副本 AbortedError 的 instanceof 失效场景
 // （工具包内抛出的 AbortedError 若经打包/深拷贝丢失原型链，仍可按 signal 状态识别）
        if (err instanceof AbortedError || signal?.aborted === true) throw err;
 // 其余抛错：结构化 isError 回填（工具名 + 参数 + 错误信息，喂回 LLM 自纠）
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
 /** 校验通过后的参数（TypeBox 校验并原始类型 coerce 后的形态，run/build 各自按 schema 约束使用） */
  parsed?: unknown;
 /** 校验失败的结构化错误（isError content） */
  error?: string;
}

/**
 * AbortSignalLike → 工具层 AbortSignal（同一运行时对象；llm 包为免 DOM lib 依赖只声明了
 * 最小结构，工具 run 签名用 DOM 类型——结构兼容，仅类型适配）
 */
function toAbortSignal(signal?: AbortSignalLike): AbortSignal | undefined {
  return signal as AbortSignal | undefined;
}

/** 参数校验失败结构化回填（工具名 + 校验器给出的字段明细 + 参数，喂回 LLM 修正后重试） */
function formatValidationError(call: DispatchToolCall, error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `工具 ${call.tool} 参数校验失败（未执行，请修正参数后重试）：${detail}；参数：${JSON.stringify(call.args)}`;
}

/** 工具执行失败结构化回填（工具名 + 参数 + 错误信息，喂回 LLM 自纠） */
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
