// 工具参数 schema：参考资料域（search_references）

import { Type, type Static } from "@earendil-works/pi-ai";

/**
 * search_references 入参：query 关键词（标题+tags 命中）+ 可选 type 分类过滤（自由文本，
 * 原预置枚举已取消，建议沿用项目内已有分类）+ 可选 tags 过滤。
 * 返回摘要列表（content 为 db `toSummary` 的截断摘要，截断长度见 db 层）。
 */
export const searchReferencesArgsSchema = Type.Object(
  {
    query: Type.String(),
    type: Type.Optional(Type.String()),
    tags: Type.Optional(Type.Array(Type.String())),
  },
  { additionalProperties: false },
);

export type SearchReferencesArgs = Static<typeof searchReferencesArgsSchema>;
