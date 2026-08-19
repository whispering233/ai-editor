// 执行类工具：参考资料（决策 36，批次九）
// execute_create_reference——propose_create_reference 确认后经 executeProposal 调度，
// 复用 executeCreateEntity（type='reference' + data 合并），补 data.type 缺省 material。
// 与 S6.7 其他执行工具同：不注册 registry（LLM 不可见）。

import type { ExecutorResult, ExecutorFn } from "./types.js";
import { requireRecord, requireString } from "./types.js";
import { executeCreateEntity } from "./entity.js";

/** execute_create_reference（tools.md「参考资料写入」：确认后写入实体，type 缺省 material） */
export const executeCreateReference: ExecutorFn = (ctx, proposal): ExecutorResult => {
  const args = proposal.args;
  const name = requireString(args, "name");
  const data = requireRecord(args, "data") as Record<string, unknown>;
  return executeCreateEntity(ctx, {
    ...proposal,
    args: {
      type: "reference", // 固定实体类型（决策 36 第 7 种实体）
      name,
      data: { ...data, type: data.type ?? "material" }, // data.type 缺省 material（schema 容错默认）
    },
  });
};
