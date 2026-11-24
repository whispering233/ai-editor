// 大纲树筛选控件（rail 页头右端）：筛选按钮 + Popover（状态 / 剧情线标签）。
//
// 与画布筛选控件（`components/outline-canvas/CanvasFilterControl.tsx`）**各自独立**：画布那份是
// 卡片级「淡化不重排」，本份是树级「隐藏」，判定纯函数在两处各自的 lib——不互相复用，避免一边加
// 维度时静默改掉另一边的语义。
// 只读展示层：状态复选框文案取 shared 标签表（不手抄）+ 树里出现过的标签 +「清除」；筛选是组件态
// （不写 localStorage、不进 URL）。标签编辑不在这里（入口 = 大纲树章详情）。
// 按钮外框画在包装 div 上：antd Button 的无层 CSS 会压掉根元素的边宽 / 圆角类（design-discipline.test.ts
// 的 antd-root-override 守卫），且包装 div 承担小圆点徽标的相对定位。
import { FilterOutlined } from "@ant-design/icons";
import { Button, Checkbox, Popover } from "antd";
import { OUTLINE_STATUS, OUTLINE_STATUS_LABEL } from "@whispering233/ai-editor-shared";
import {
  EMPTY_OUTLINE_FILTER,
  isOutlineFilterActive,
  toggleFilterValue,
  type OutlineFilter,
} from "../../lib/outline-tree";
import { cn } from "../../lib/utils";

interface OutlineFilterControlProps {
  filter: OutlineFilter;
  /** 标签池（`chapterTagPool` 派生序：使用次数降序、同频字典序） */
  tagOptions: readonly string[];
  onChange: (filter: OutlineFilter) => void;
}

function FilterPanel({ filter, tagOptions, onChange }: OutlineFilterControlProps) {
  return (
    <div className="flex w-56 flex-col gap-2">
      <span className="text-xs text-muted-foreground">状态</span>
      {OUTLINE_STATUS.map((status) => (
        <Checkbox
          key={status}
          checked={filter.statuses.includes(status)}
          onChange={() =>
            onChange({ ...filter, statuses: toggleFilterValue(filter.statuses, status) })
          }
        >
          {OUTLINE_STATUS_LABEL[status]}
        </Checkbox>
      ))}
      <span className="text-xs text-muted-foreground">剧情线标签</span>
      {tagOptions.length === 0 ? (
        <span className="text-xs text-muted-foreground">还没有标签</span>
      ) : (
        // 长标签表自身滚动：不把 Popover 撑出 rail
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {tagOptions.map((tag) => (
            <Checkbox
              key={tag}
              checked={filter.tags.includes(tag)}
              onChange={() => onChange({ ...filter, tags: toggleFilterValue(filter.tags, tag) })}
            >
              #{tag}
            </Checkbox>
          ))}
        </div>
      )}
      <Button
        type="text"
        size="small"
        block
        disabled={!isOutlineFilterActive(filter)}
        onClick={() => onChange(EMPTY_OUTLINE_FILTER)}
      >
        清除
      </Button>
    </div>
  );
}

export function OutlineFilterControl({ filter, tagOptions, onChange }: OutlineFilterControlProps) {
  const active = isOutlineFilterActive(filter);
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      content={<FilterPanel filter={filter} tagOptions={tagOptions} onChange={onChange} />}
    >
      <div
        className={cn(
          "relative rounded-md border bg-card",
          active ? "border-primary" : "border-border",
        )}
      >
        <Button
          type="text"
          size="small"
          aria-label="筛选大纲"
          title="筛选大纲"
          icon={<FilterOutlined />}
        />
        {active && (
          <span aria-hidden className="absolute right-1 top-1 size-1 rounded-full bg-primary" />
        )}
      </div>
    </Popover>
  );
}