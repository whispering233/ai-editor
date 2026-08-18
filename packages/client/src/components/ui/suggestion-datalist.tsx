// 原生 datalist 自动完成（批次五 J2，决策 31）：浏览器输入行为自动弹出的快捷候选。
// 输入框加 `list={id}` 属性 + 本组件渲染 <datalist>；候选为空不渲染（避免空 datalist 残留）。
// 纯展示组件，无状态；候选由调用方按当前类型/编辑情形聚合（现有数据/枚举）。
export function SuggestionDatalist({ id, options }: { id: string; options: readonly string[] }) {
  if (options.length === 0) return null;
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}

/** 字符串数组去重（保留首次出现顺序；过滤空串）——datalist 候选聚合 helper */
export function uniqueStrings(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of values) {
    if (typeof v === "string" && v !== "" && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  return out;
}
