// 标签输入建议区（F8，timeline.md 标签输入建议节）
// 职责：纯展示——tags 输入框下方卡片（mt-1 + bg-card border border-border rounded-md，规格）展示
// 匹配建议，行内轻量样式（text-xs + hover 高亮 + cursor-pointer），点选回调父组件填入
// （applyTagSuggestion：替换最后一段 + 追加逗号）。两页共用（列表页新建/编辑对话框、详情页表单）；
// 建议计算在调用方（suggestTags 纯函数）——本组件只收「已匹配的建议」与 onPick。
// 可见性：visible=false 或 suggestions 为空 → 不渲染（无匹配 / 最后一段空 / 无已存在标签，
// 规格「不显示建议区」；空段匹配已由 suggestTags 保证，visible 是调用方额外显式开关）。
// 焦点保持：onMouseDown preventDefault 阻止输入框失焦（点选后输入框保持焦点、建议区随输入更新）。
// 样式：全部 token 类（bg-card/border-border/text-muted-foreground/hover:bg-muted），禁硬编码色类。
interface TagSuggestProps {
  /** 建议标签列表（已按 suggestTags 匹配/排除/截断；空 → 不渲染） */
  suggestions: string[];
  /** 显式可见开关（false = 不渲染；调用方额外条件，如输入框为空） */
  visible: boolean;
  /** 点选回调（父组件 applyTagSuggestion 填入 + 保持表单 state） */
  onPick: (tag: string) => void;
}

export function TagSuggest({ suggestions, visible, onPick }: TagSuggestProps) {
  if (!visible || suggestions.length === 0) return null;
  return (
    <div className="mt-1 overflow-hidden rounded-md border border-border bg-card">
      {suggestions.map((tag) => (
        <button
          key={tag}
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(tag)}
          className="block w-full cursor-pointer px-2.5 py-1 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          {tag}
        </button>
      ))}
    </div>
  );
}
