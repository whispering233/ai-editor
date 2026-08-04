// 执行类工具：实体（S6.7，tools.md「执行类」3 个）
// create_entity / update_entity / delete_entity
//
// 与 S6.6 提案工具的核心差异：**直接调 db 写层落库**（唯一写路径，S7.5 确认后由 executor
// 门面调用）；抛错即失败（事务/单语句失败向上传播，S7.5 转错误响应）。不注册 registry
// （registry 是 LLM 可见工具表；执行类不暴露给 LLM，tools.md「核心设计原则」）。
//
// 语义对齐（决策 12/14）：
// - create_entity：type/name 必填 + data 可选，id 由 db 层生成（char-/set-/loc-/hook- 前缀）
// - update_entity：patches 为 data **浅合并**字段（未传字段保留，endpoints.md 第 267 行）；
//   软删实体不可更新（getEntity 过滤 → null → 抛错）
// - delete_entity：软删 + 级联关系与 Delta（决策 12，本体保留可回收站还原）
// 参数形态：与 S6.6 proposal.args 对齐（propose_create_entity → { type, name, data? } 等），
// 由 executeProposal 按 proposal.type 映射后直接消费。

import { createEntity, nowIso, softDeleteEntity, updateEntity } from "@whispering233/ai-editor-db";
import type { EntityType } from "@whispering233/ai-editor-shared";
import { optionalRecord, requireRecord, requireString, type ExecutorFn } from "./types.js";

/** create_entity（tools.md：create_entity(type, name, data) → id） */
export const executeCreateEntity: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const row = createEntity(ctx.db, {
    type: requireString(args, "type") as EntityType, // 提案层 zod 校验（ENTITY_TYPES），此处防御
    name: requireString(args, "name"),
    data: optionalRecord(args, "data"),
  });
  return { id: row.id };
};

/** update_entity（tools.md：update_entity(id, patches) → updated；patches 浅合并进 data） */
export const executeUpdateEntity: ExecutorFn = (ctx, proposal) => {
  const args = proposal.args;
  const entityId = requireString(args, "entity_id");
  const patches = requireRecord(args, "patches");
  const row = updateEntity(ctx.db, entityId, { data: patches }); // data 浅合并（决策 23 同语义）
  if (row === null) {
    throw new Error(`实体不存在或已软删: ${entityId}`);
  }
  return { id: row.id, updated: true };
};

/** delete_entity（tools.md：delete_entity(id) → void；软删 + 级联，可回收站还原，决策 12） */
export const executeDeleteEntity: ExecutorFn = (ctx, proposal) => {
  const entityId = requireString(proposal.args, "entity_id");
  const result = softDeleteEntity(ctx.db, entityId, nowIso());
  if (result === null) {
    throw new Error(`实体不存在或已软删: ${entityId}`);
  }
  return { id: entityId, deleted: true, cascaded: result };
};
