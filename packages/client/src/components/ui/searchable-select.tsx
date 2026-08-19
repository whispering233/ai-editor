// 可搜索下拉（批次八 O1，2026-08）：Popover 非模态 + 关键词**客户端过滤已加载候选**。
// 场景：设定列表「上级设定 / 标签」筛选（候选已由页面聚合：parentOptions ≤200、tagOptions），
// 区别于 parent-setting-select.tsx（服务端防抖搜索）——本组件候选一次性传入、客户端过滤。
// 能力：顶部恒有「全部」清除项；已选值不在候选中（软删/超截断）时用 fallbackLabel 兜底显示；
// 输入内 Enter 选中首个过滤结果、Esc/点外部关闭（Popover 默认）；样式全 token 类（layout.md §3），
// 触发钮为 border 文字按钮（H4）。
import { useState } from "react";
import type { KeyboardEvent } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export interface SearchableSelectOption {
  value: string;
  label: string;
}

/** 候选过滤（纯函数，可单测）：trim + 大小写不敏感 label contains；空 q = 全量（返回副本） */
export function filterOptions(
  options: readonly SearchableSelectOption[],
  q: string,
): SearchableSelectOption[] {
  const query = q.trim().toLowerCase();
  if (query === "") return [...options];
  return options.filter((o) => o.label.toLowerCase().includes(query));
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder,
  ariaLabel,
  fallbackLabel,
}: {
  /** 当前选中值（"" = 全部） */
  value: string;
  /** 候选（页面已聚合；按需排序） */
  options: readonly SearchableSelectOption[];
  /** 选中回调（"" = 清除筛选） */
  onChange: (value: string) => void;
  /** 空值显示（如「全部」）；同时作弹层顶部清除项文案 */
  placeholder: string;
  ariaLabel: string;
  /** 已选值不在候选中时的兜底显示名（如「（已删除或不可见）」）；缺省回退 value 原文 */
  fallbackLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.value === value);
  const displayLabel = selected?.label ?? (value !== "" ? (fallbackLabel ?? value) : "");

  // 打开时清空上次搜索词（防残留关键词影响新一次选择）；关闭时不动搜索词（下次打开再清）
  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (next) setQ("");
  }

  const filtered = filterOptions(options, q);

  /** 输入内 Enter：选中首个过滤结果（清除走显式「全部」行）；Esc 关闭 */
  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      if (filtered.length === 0) return;
      onChange(filtered[0].value);
      setOpen(false);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger
        render={
          <button
            type="button"
            aria-label={ariaLabel}
            className={cn(
              "flex items-center rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              displayLabel === "" && "text-muted-foreground",
            )}
          >
            <span className="min-w-0 truncate">
              {displayLabel === "" ? placeholder : displayLabel}
            </span>
            <span aria-hidden="true" className="ml-1 shrink-0 text-muted-foreground">
              &#9662;
            </span>
          </button>
        }
      />
      <PopoverContent className="flex w-64 flex-col gap-2 p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="搜索…"
          aria-label={`${ariaLabel}搜索`}
          className="h-8 text-sm"
          autoFocus
        />
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {/* 「全部」清除项：恒在顶部；当前即「全部」时高亮 */}
          <button
            type="button"
            onClick={() => {
              onChange("");
              setOpen(false);
            }}
            className={cn(
              "flex min-w-0 items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted hover:text-foreground",
              value === "" && "bg-muted/70",
            )}
          >
            {placeholder}
          </button>
          {filtered.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">无匹配选项</p>
          ) : (
            filtered.map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
                className={cn(
                  "flex min-w-0 items-center rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted hover:text-foreground",
                  o.value === value && "bg-muted/70",
                )}
              >
                <span className="min-w-0 truncate">{o.label}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
