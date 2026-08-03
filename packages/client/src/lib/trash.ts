// 回收站页纯函数（S4.4）：toast 文案组装 + 409 祖先 id 解析（无副作用，可单测）
// 契约来源：doc/ui/pages/trash.md「关键交互」——还原 toast 摘要（计数为 0 省略）、
//   OUTLINE_ANCESTOR_DELETED 祖先提示（祖先名从 409 message 解析，服务端格式见
//   packages/server/src/routes/trash.ts：`存在软删祖先 ${ancestorId}，请先还原祖先再还原本节点`）

/** 还原实体 toast 文案：连带恢复计数为 0 时省略对应部分（如「已还原」/「已还原，连带恢复 2 条关系」） */
export function restoreEntityToast(relations: number, deltas: number): string {
  const parts: string[] = [];
  if (relations > 0) parts.push(`${relations} 条关系`);
  if (deltas > 0) parts.push(`${deltas} 条变更记录`);
  return parts.length > 0 ? `已还原，连带恢复 ${parts.join("、")}` : "已还原";
}

/** 还原节点 toast 文案：子节点计数为 0 时省略（如「已还原」/「已还原（含 3 个子节点）」） */
export function restoreNodeToast(children: number): string {
  return children > 0 ? `已还原（含 ${children} 个子节点）` : "已还原";
}

/**
 * 从 409 OUTLINE_ANCESTOR_DELETED 的 message 提取软删祖先 id。
 * 服务端 message 格式：`存在软删祖先 ch-3，请先还原祖先再还原本节点`；
 * 解析失败（格式变化）返回 null——页面此时只提示「先还原上级」不渲染快捷按钮。
 */
export function parseAncestorId(message: string): string | null {
  const m = /软删祖先\s+([^\s，,]+)/.exec(message);
  return m?.[1] ?? null;
}
