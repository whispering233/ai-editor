// 执行类工具：参考资料
// execute_create_reference——propose_create_reference 确认后经 executeProposal 调度，
// 复用 executeCreateEntity（type='reference' + data 合并），补 data.type 缺省 material。
// 与 S6.7 其他执行工具同：不注册 registry（LLM 不可见）。
//
// 正文装载（卡 12.9，与 12.7a 的服务端约定一致）：
// - 提案的 `data.content` = **纯文本摘录**（可含换行），落库时从 entities.data 拆出
//   （`data` 只留 type/url/tags 等短字段）
// - 真相 = `document_records.content`：按行拆为**段落块**（每行一个 paragraph；不引
//   @blocknote——服务端不解析块语义，也不做 markdown 转换，作者在编辑器里自行排版）
// - `content_text` = 该纯文本本身（AI 摘录的就是投影文本，无需再走一次块投影）
// - 同一事务写入：实体行与文档行要么都在，要么都不在

import { nowIso, upsertDocument, withTransaction } from "@whispering233/ai-editor-db";
import type { ExecutorResult, ExecutorFn } from "./types.js";
import { requireRecord, requireString } from "./types.js";
import { executeCreateEntity } from "./entity.js";

/**
 * 纯文本 → 段落块数组（块数组最小形态：每行一个 paragraph；空行 = 空段落，
 * 保作者摘录的空行结构）。块 JSON 即 `document_records.content` 真相形态。
 */
function paragraphBlocksOf(text: string): unknown[] {
  return text.split("\n").map((line) => ({
    type: "paragraph",
    content: line === "" ? [] : [{ type: "text", text: line }],
  }));
}

/** 拆出提案 data 里的纯文本正文（未携带 → null = 先建条目后写正文，不落文档行） */
function splitContent(data: Record<string, unknown>): { content: string | null; rest: Record<string, unknown> } {
  const raw = data.content;
  const rest = { ...data };
  delete rest.content;
  if (raw === undefined) return { content: null, rest };
  if (typeof raw !== "string") {
    throw new Error("执行参数缺失或非法: data.content");
  }
  return { content: raw, rest };
}

/** execute_create_reference（「参考资料写入」：确认后写入实体 + 正文文档行，type 缺省 material） */
export const executeCreateReference: ExecutorFn = (ctx, proposal): ExecutorResult => {
  const args = proposal.args;
  const name = requireString(args, "name");
  const data = requireRecord(args, "data") as Record<string, unknown>;
  const { content, rest } = splitContent(data);
  const now = nowIso();
  return withTransaction(ctx.db, () => {
    const created = executeCreateEntity(ctx, {
      ...proposal,
      args: {
        type: "reference", // 固定实体类型（第 7 种实体）
        name,
        data: { ...rest, type: rest.type ?? "material" }, // data.type 缺省 material（schema 容错默认）
      },
    });
    if (content !== null) {
      upsertDocument(ctx.db, {
        ownerKind: "reference",
        ownerId: requireString(created, "id"), // executeCreateEntity 恒返回新 id（防御取用）
        content: JSON.stringify(paragraphBlocksOf(content)),
        contentText: content,
        now,
      });
    }
    return created;
  });
};
