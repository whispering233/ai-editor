// 关系说明（`metadata.label` / `metadata.description`）的客户端口径：上限单源 + 提交 payload 构造。
// 删键语义（空串 / trim）不在客户端实现——`PUT /relation/:id` 的 metadata 是**整体替换**，
// 字段归一唯一实现 = shared `normalizeRelationMetadata`（服务端执行；见 docs/api/40-api-relation.md）。

/** 短标签上限（画布连线上显示） */
export const RELATION_LABEL_MAX = 40;
/** 长说明上限（只在抽屉 / 关联页展示） */
export const RELATION_DESCRIPTION_MAX = 500;

/** 编辑态草稿（两个字段都是字符串，便于受控表单） */
export interface RelationMetadataDraft {
  label: string;
  description: string;
}

/** 存量 metadata → 草稿（自由袋里的非字符串值按空串处理） */
export function relationMetadataDraft(
  metadata: Record<string, unknown> | undefined,
): RelationMetadataDraft {
  return {
    label: typeof metadata?.label === "string" ? metadata.label : "",
    description: typeof metadata?.description === "string" ? metadata.description : "",
  };
}

/**
 * 提交 payload：`base` 里的其它键**必须保留**——PUT 是整体替换，丢掉就是静默删数据。
 * 空串原样发（服务端 `normalizeRelationMetadata` 负责删键）。
 */
export function buildRelationMetadataPayload(
  base: Record<string, unknown> | undefined,
  draft: RelationMetadataDraft,
): Record<string, unknown> {
  return { ...base, label: draft.label.trim(), description: draft.description.trim() };
}
