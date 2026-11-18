// 画布筛选控件（左上工具条的第一格）：筛选按钮 + Popover（契约：docs/ui/DESIGN.md `outline-canvas`「筛选」）。
//
// 只读展示层：状态三复选框（文案取 shared 标签表，不手抄）+ 当前树出现过的标签 +「清除」；
// 筛选是组件态（不写 localStorage、不进 URL）。标签编辑不在这里（入口 = 大纲树章详情）。
// 按钮外框画在包装 div 上：antd Button 的无层 CSS 会压掉根元素的边宽 / 圆角类（design-discipline.test.ts
// 的 antd-root-override 守卫），且包装 div 承担小圆点徽标的相对定位。
import { FilterOutlined } from "@ant-design/icons";
import { Button, Checkbox, Popover } from "antd";
import { OUTLINE_STATUS, OUTLINE_STATUS_LABEL } from "@whispering233/ai-editor-shared";
import {
  EMPTY_CANVAS_FILTER,
  isCanvasFilterActive,
  type CanvasFilter,
} from "../../lib/outline-canvas-filter";
import { cn } from "../../lib/utils";

interface CanvasFilterControlProps {
  filter: CanvasFilter;
  /** 标签池（`canvasTagOptions` 已排序） */
  tagOptions: readonly string[];
  onChange: (filter: CanvasFilter) => void;
}

/** 数组内切换一个值（不改原数组：筛选条件按引用比较） */
function toggled(values: readonly string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((candidate) => candidate !== value)
    : [...values, value];
}

function FilterPanel({ filter, tagOptions, onChange }: CanvasFilterControlProps) {
  return (
    <div className="flex w-56 flex-col gap-2">
      <span className="text-xs text-muted-foreground">状态</span>
      {OUTLINE_STATUS.map((status) => (
        <Checkbox
          key={status}
          checked={filter.statuses.includes(status)}
          onChange={() => onChange({ ...filter, statuses: toggled(filter.statuses, status) })}
        >
          {OUTLINE_STATUS_LABEL[status]}
        </Checkbox>
      ))}
      <span className="text-xs text-muted-foreground">剧情线标签</span>
      {tagOptions.length === 0 ? (
        <span className="text-xs text-muted-foreground">还没有标签</span>
      ) : (
        // 长标签表自身滚动：不把 Popover 撑出画布
        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
          {tagOptions.map((tag) => (
            <Checkbox
              key={tag}
              checked={filter.tags.includes(tag)}
              onChange={() => onChange({ ...filter, tags: toggled(filter.tags, tag) })}
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
        disabled={!isCanvasFilterActive(filter)}
        onClick={() => onChange(EMPTY_CANVAS_FILTER)}
      >
        清除
      </Button>
    </div>
  );
}

export function CanvasFilterControl({ filter, tagOptions, onChange }: CanvasFilterControlProps) {
  const active = isCanvasFilterActive(filter);
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
        <Button type="text" size="small" aria-label="筛选章节" title="筛选章节" icon={<FilterOutlined />} />
        {active && (
          <span aria-hidden className="absolute right-1 top-1 size-1 rounded-full bg-primary" />
        )}
      </div>
    </Popover>
  );
}
