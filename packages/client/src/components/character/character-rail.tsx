// 人物工作台左栏（卡 3.1）：**它就是人物列表本身**（人物不再有独立列表页）
// 契约：docs/ui/DESIGN.md §数据展示 `character-workbench`——240px 固定宽、右侧 1px hairline、
// 行 = 姓名 + 角色定位（caption/tertiary）、32px 行高、{rounded.sm}、
// 选中 = {colors.surface-muted} 灰面（`bg-accent` = antd colorFillTertiary，与 menu-item-selected 同语言）+ 文字不变色。
// 纯展示组件（数据/请求由页面持有）——便于用 react-dom/server 直渲染富数据走查（仓内无 jsdom）。
import type { ReactNode } from "react";
import { Button, Input, Select } from "antd";
import { SearchOutlined } from "@ant-design/icons";
import { errorBannerClass, skeletonClass } from "@/lib/styles";
import { cn } from "../../lib/utils";
import { RAIL_SORT_OPTIONS, type CharacterRailItem } from "../../lib/character-workbench";

/** 左栏宽度（DESIGN 登记档：240px） */
export const RAIL_WIDTH_CLASS = "w-60";

export interface CharacterRailProps {
  items: CharacterRailItem[];
  /** 当前选中角色 id（未选中 = 空态右栏） */
  selectedId: string | null;
  loading: boolean;
  /** 错误文案（非空 → 错误横幅 + 重试；列表不可用） */
  error: string | null;
  /** 搜索输入值（受控；服务端模糊匹配 name） */
  qInput: string;
  onQInputChange: (value: string) => void;
  sortValue: string;
  onSortChange: (value: string) => void;
  /** 溢出提示（`railOverflowHint` 产出；空串 = 不渲染） */
  overflowHint: string;
  onSelect: (id: string) => void;
  onRetry: () => void;
  /** 行尾操作区（卡 3.5 的新建入口挂在控件行；此处留给后续卡的更多动作） */
  headerExtra?: ReactNode;
  /** 覆盖类（窄屏两级导航时全宽：`w-full border-r-0`——`cn` 用 twMerge，同属性后者胜） */
  className?: string;
}

export function CharacterRail({
  items,
  selectedId,
  loading,
  error,
  qInput,
  onQInputChange,
  sortValue,
  onSortChange,
  overflowHint,
  onSelect,
  onRetry,
  headerExtra,
  className,
}: CharacterRailProps) {
  return (
    <aside
      className={cn("flex shrink-0 flex-col border-r border-border", RAIL_WIDTH_CLASS, className)}
    >
      {/* 控件行：搜索（192px 登记档）+ 排序；窄栏放不下并排，故拆两行（见报告说明） */}
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-3 py-2">
        <div className="w-48">
          <Input
            prefix={<SearchOutlined />}
            allowClear
            value={qInput}
            onChange={(e) => onQInputChange(e.target.value)}
            placeholder="搜索人物名称…"
          />
        </div>
        <div className="flex items-center gap-2">
          <Select
            size="small"
            className="min-w-0 flex-1"
            value={sortValue}
            onChange={onSortChange}
            options={RAIL_SORT_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
            popupMatchSelectWidth={false}
            aria-label="排序"
          />
          {headerExtra}
        </div>
        {overflowHint !== "" && <p className="text-xs text-muted-foreground">{overflowHint}</p>}
      </div>

      {/* 列表区（独立滚动） */}
      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {error !== null && (
          <div className="space-y-2">
            <p className={errorBannerClass}>{error}</p>
            <Button block onClick={onRetry}>
              重试
            </Button>
          </div>
        )}

        {error === null && loading && items.length === 0 && (
          <div className="space-y-1.5">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <div key={i} className={cn(skeletonClass, "h-8")} />
            ))}
          </div>
        )}

        {error === null && !loading && items.length === 0 && (
          <p className="px-2 py-6 text-center text-xs text-muted-foreground">
            {qInput.trim() === "" ? "还没有人物" : "没有匹配的人物"}
          </p>
        )}

        {error === null && items.length > 0 && (
          <ul className="space-y-0.5">
            {items.map((item) => {
              const selected = item.id === selectedId;
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    data-character-id={item.id}
                    onClick={() => onSelect(item.id)}
                    title={item.role === "" ? item.name : `${item.name}（${item.role}）`}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left transition-colors",
                      selected ? "bg-accent text-foreground" : "text-foreground hover:bg-muted",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate text-sm">{item.name}</span>
                    {item.role !== "" && (
                      <span className="max-w-[45%] shrink-0 truncate text-xs text-muted-foreground">
                        {item.role}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
