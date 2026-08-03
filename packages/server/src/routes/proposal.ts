// 提案路由（S7.5）：POST /api/v1/proposal/:proposalId/confirm | reject
//
// 契约来源：doc/api/endpoints.md「提案确认」（第 848-888 行）、决策 14（仅内存 / TTL / 快照重校验 /
//   项目绑定）、决策 19（大纲节点用节点级 updated_at 快照）。
// 错误映射（对照 endpoints.md 错误码）：
//   提案不存在/已过期 → 404 PROPOSAL_NOT_FOUND（store.get 与 peek 均不可见）
//   提案所属项目 ≠ 当前项目 → 409 PROPOSAL_PROJECT_MISMATCH（决策 14 修订：get 返回 null 后
//     peek 仍可见 ⇒ 跨项目误操作；防御性——正常流程切换项目时提案已被清空）
//   快照重校验失败 → 409 PROPOSAL_STALE（决策 14：引用对象不存在 **或** updated_at 不一致，
//     任一失败即 STALE；前端提示重新生成提案）
//   执行失败 → 500 INTERNAL_ERROR（契约未定义该错误码——执行失败属服务端状态异常/数据竞争，
//     前端按通用错误呈现）
//
// 消费方：defaultProposalStore（@ai-editor/agent S7.4 提案仓，与调度同仓消费）+ executeProposal
//   （@ai-editor/tools S6.7 执行门面，按 proposal.type 映射执行函数，args 直接消费执行形态）。
//
// 提案移除语义（一次性消费，决策 14「提案是毫秒级交互对象、无跨会话恢复」落地）：
//   confirm/reject 任一动作到达即消费——确认成功、快照过期、执行失败、拒绝均为终态，
//   处理完立即 remove 出仓。残留只会造成两类问题：① 重复 confirm 同一无引用提案
//   （如 propose_create_entity）会**重复执行**产生重复数据；② 已过期提案反复返回 409 无意义
//   （前端按 PROPOSAL_STALE 引导重新生成，保留不提供任何重试价值）。故失败同样移除。
import { Hono } from "hono";
import { defaultProposalStore } from "@ai-editor/agent";
import { executeProposal } from "@ai-editor/tools";
import type { Proposal, ProposalReference } from "@ai-editor/tools";
import type { OutlineFileTree } from "@ai-editor/shared";
import { findOutlineNode, getDeltaRow, getEntity, getRelation, readOutlineFile } from "@ai-editor/db";
import { HttpError, ok } from "../middleware/error.js";
import { requireCurrentProject, type ProjectContext } from "../middleware/project.js";

/** 提案路由（挂载于 /api/v1/proposal，index.ts） */
export const proposalRoutes = new Hono();

/** 快照校验失败统一映射 409 PROPOSAL_STALE（决策 14：存在性 + updated_at 任一失败即 STALE） */
function throwProposalStale(ref: ProposalReference): never {
  throw new HttpError(
    409,
    "PROPOSAL_STALE",
    `提案引用对象已变化或不存在: kind=${ref.kind} id=${ref.id}（请重新生成提案）`,
  );
}

/**
 * 单条引用快照重校验（决策 14/19）：
 * - kind=entity：getEntity 查 entities（已过滤软删，决策 12）——不存在/软删 → null → STALE；
 *   存在则比对实体自身 updated_at（软删/还原亦刷新版本戳，决策 12 修订，语义统一）
 * - kind=relation：getRelation（自身软删 + 端点软删联动过滤，决策 12 修订）——不可见 → STALE；
 *   存在则比对关系自身 updated_at
 * - kind=delta：getDeltaRow（记录级：自身软删视为不存在）——不存在 → STALE；比对自身 updated_at
 * - kind=outline_node：findOutlineNode 查**调用方预读的树**（S2：references 含多条 outline_node
 *   时不重复读文件；校验前同步读树一次，无间隙）——节点不存在或软删（决策 12）→ STALE；
 *   存在则比对**节点级** updated_at（决策 19）
 * - default（防静默，oracle S1）：未知 kind 属上层调度/构造 bug（决策 14 契约仅 4 类引用），
 *   跳过校验直接放行会让提案绕过快照重校验，按内部错误显式拒绝
 * 三种 DB 引用不查大纲可见性联动（getRelation 例外——其 API 内置端点过滤）：
 * 提案引用的是记录本身，「存在性 + 自身 updated_at」即决策 14 契约字面语义。
 */
function assertReferenceFresh(project: ProjectContext, tree: OutlineFileTree, ref: ProposalReference): void {
  switch (ref.kind) {
    case "entity": {
      const row = getEntity(project.db, ref.id);
      if (row === null || row.updated_at !== ref.updated_at) throwProposalStale(ref);
      return;
    }
    case "relation": {
      const row = getRelation(project.db, ref.id, project.root);
      if (row === null || row.updated_at !== ref.updated_at) throwProposalStale(ref);
      return;
    }
    case "delta": {
      const row = getDeltaRow(project.db, ref.id);
      if (row === null || row.updated_at !== ref.updated_at) throwProposalStale(ref);
      return;
    }
    case "outline_node": {
      const node = findOutlineNode(tree, ref.id);
      if (node === undefined || node.deleted === true || node.updated_at !== ref.updated_at) {
        throwProposalStale(ref);
      }
      return;
    }
    default: {
      // 防静默：never 断言提供编译期穷尽性——未来 ProposalReferenceKind 新增成员时
      // 本行编译报错，强制补 case 而非静默漏校验（oracle S1）
      const exhaustive: never = ref.kind;
      throw new HttpError(500, "INTERNAL_ERROR", `未知提案引用类型: ${String(exhaustive)}`);
    }
  }
}

/**
 * 取当前项目提案（confirm/reject 共用，决策 14 修订项目绑定）：
 * store.get(id, projectId) 校验项目归属；返回 null 时 peek 区分两种不可见——
 *   peek 可见 ⇒ 提案属于其他项目 → 409 PROPOSAL_PROJECT_MISMATCH（不误报 404）；
 *   peek 不可见 ⇒ 不存在或已过期 → 404 PROPOSAL_NOT_FOUND。
 * 注意 peek 走仓内惰性过期清理（决策 14 TTL），超期条目同样归入 404。
 */
function resolveProposal(proposalId: string, projectId: string): Proposal {
  const proposal = defaultProposalStore.get(proposalId, projectId);
  if (proposal !== null) return proposal;
  if (defaultProposalStore.peek(proposalId) !== null) {
    throw new HttpError(409, "PROPOSAL_PROJECT_MISMATCH", `提案所属项目与当前项目不一致: ${proposalId}`);
  }
  throw new HttpError(404, "PROPOSAL_NOT_FOUND", `提案不存在或已过期: ${proposalId}`);
}

// POST /api/v1/proposal/:proposalId/confirm —— 用户确认提案（endpoints.md 第 850-874 行）
// 流程：项目归属解析（404/409）→ 快照逐条重校验（409 PROPOSAL_STALE）→
//   executeProposal({ db, outlineDir: project.root, projectId }, proposal) →
//   200 { confirmed: true, result }（ok 包裹，result 为执行结果如新创建的 entity id）。
// 提案移除在 finally 中（一次性消费，见文件头注释）：校验通过 / 快照过期 / 执行失败均为终态，
//   确认动作即消费；404/409 MISMATCH 由 resolveProposal 在 try 之前抛出，不进入本块
//   （跨项目提案不消费）。executeProposal 为同步调用（withTransaction 包复合写），
//   单线程下「执行后移除」与「执行前移除」无竞态差异。
proposalRoutes.post("/:proposalId/confirm", (c) => {
  const project = requireCurrentProject();
  const proposal = resolveProposal(c.req.param("proposalId"), project.config.id);
  try {
    // 快照重校验（决策 14：存在性 + updated_at 比对，任一失败 409 PROPOSAL_STALE）；
    // 树在校验前读一次（S2：多条 outline_node 引用不重复读文件，同步读取无间隙）
    const tree = readOutlineFile(project.root);
    for (const ref of proposal.references) {
      assertReferenceFresh(project, tree, ref);
    }
    let result: unknown;
    try {
      result = executeProposal(
        { db: project.db, outlineDir: project.root, projectId: project.config.id },
        proposal,
      );
    } catch (err) {
      // 执行失败（幂等冲突/数据竞争/防御校验抛错）：契约未定义该错误码，按 500 内部错误呈现；
      // 前端按通用错误引导重新生成，不保留重试（重试仍会失败）
      throw new HttpError(500, "INTERNAL_ERROR", err instanceof Error ? err.message : "提案执行失败");
    }
    return c.json(ok({ confirmed: true, result }));
  } finally {
    // 一次性消费（决策 14 瞬态交互对象）：终态即移除——残留只会让重复 confirm
    // 对无引用提案（propose_create_entity）产生重复执行，或对过期提案反复返回 409
    defaultProposalStore.remove(proposal.proposal_id);
  }
});

// POST /api/v1/proposal/:proposalId/reject —— 用户拒绝提案（endpoints.md 第 876-888 行）
// 项目归属校验与 confirm 同语义（决策 14 修订原文「confirm/reject 时校验与当前项目一致」——
// 拒绝同样是不可逆消费动作，跨项目拒绝会误伤他项目待确认提案，故 404/409 MISMATCH 同 confirm）。
// 校验通过 → 移除（拒绝即消费）→ 200 { rejected: true }。
proposalRoutes.post("/:proposalId/reject", (c) => {
  const project = requireCurrentProject();
  const proposal = resolveProposal(c.req.param("proposalId"), project.config.id);
  defaultProposalStore.remove(proposal.proposal_id);
  return c.json(ok({ rejected: true }));
});
