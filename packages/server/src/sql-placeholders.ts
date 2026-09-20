// SQL IN 占位符串构造（唯一实现：启动一致性校验 `consistency.ts` 与级联软删
// `routes/outline.ts` 共用——曾各写一份，改一处漏一处的风险）。
// id 集来自服务端生成的 nanoid（无注入面）；空集返回 "(NULL)" 恒假（不产生 `IN ()` 语法错）。
export function inPlaceholders(ids: string[]): string {
  return ids.length === 0 ? "(NULL)" : `(${ids.map(() => "?").join(",")})`;
}
