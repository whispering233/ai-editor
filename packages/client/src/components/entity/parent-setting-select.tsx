// 上级设定选择器（批次四 I3b，决策 30）：设定层级 = belongs_to 关系（子 → 父），
// data.parent_id 已废弃——选择器候选 = 现有 setting 列表（listEntities 防抖搜索）。
// 复用 UX3 轻量弹层模式（Popover 非模态：不打断页面，点外部/Esc 关闭）；
// 候选 limit 100 + 名称排序，「设定数量超 100 时用搜索补位」（决策 30 性能方案，
// 不做虚拟滚动等过度设计）。
// 样式 token 类（layout.md §3）；文字按钮带边框（H4）。
import { useEffect, useState } from "react";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { listEntities } from "../../lib/api";
import { cn } from "../../lib/utils";

const CANDIDATE_LIMIT = 100;

export function ParentSettingSelect({
  value,
  valueName,
  excludeIds,
  onChange,
  placeholder = "上级设定（选填）",
}: {
  /** 当前选中父设定 id（null = 未设置） */
  value: string | null;
  /** 外部已知的选中显示名（详情页来自 relations 联表；缺省用候选匹配/id 兜底） */
  valueName?: string;
  /** 候选排除 id（详情页排除自身；新建场景为空） */
  excludeIds?: string[];
  onChange: (id: string | null) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<EntitySummary[] | null>(null);
  const [q, setQ] = useState("");
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);

  async function loadCandidates() {
    setLoading(true);
    setFailed(false);
    try {
      const res = await listEntities("setting", {
        q: q.trim() || undefined,
        limit: CANDIDATE_LIMIT,
        sort: "name",
      });
      setCandidates(excludeIds && excludeIds.length > 0 ? res.items.filter((c) => !excludeIds.includes(c.id)) : res.items);
    } catch {
      setCandidates(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  // 打开时拉首屏；搜索防抖 300ms（与列表页搜索同节奏）
  useEffect(() => {
    if (!open) return;
    void loadCandidates();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const t = setTimeout(() => void loadCandidates(), 300);
    return () => clearTimeout(t);
  }, [q, open]);

  // 触发按钮显示：选中名称（外部提供 > 候选匹配 > id 兜底）；未选中渲染占位
  const displayName = value
    ? (valueName ?? candidates?.find((c) => c.id === value)?.name ?? value)
    : "";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            type="button"
            className={cn("h-8 px-2 text-xs font-normal", !value && "text-muted-foreground")}
            title={value ? `上级设定：${displayName}` : placeholder}
          >
            {value ? `上级：${displayName}` : placeholder}
            <span aria-hidden="true" className="ml-1 text-muted-foreground">&#9662;</span>
          </Button>
        }
      />
      <PopoverContent className="flex w-72 flex-col gap-2 p-2">
        <Input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="搜索设定名称…"
          className="h-8 text-sm"
          autoFocus
        />
        <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto">
          {loading && candidates === null ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">加载中…</p>
          ) : failed ? (
            <div className="flex items-center justify-between gap-2 px-2 py-3">
              <span className="text-xs text-destructive">列表加载失败</span>
              <Button variant="outline" type="button" size="sm" className="h-7 px-2 text-xs" onClick={() => void loadCandidates()}>
                重试
              </Button>
            </div>
          ) : candidates !== null && candidates.length === 0 ? (
            <p className="px-2 py-3 text-center text-xs text-muted-foreground">
              {q ? "没有匹配的设定" : "还没有其他设定"}
            </p>
          ) : (
            candidates?.map((c) => {
              const category = typeof c.summary?.category === "string" ? c.summary.category : "";
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onChange(c.id);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex min-w-0 items-baseline gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-muted hover:text-foreground",
                    c.id === value && "bg-muted/70",
                  )}
                >
                  <span className="min-w-0 truncate">{c.name}</span>
                  {category && <span className="shrink-0 text-xs text-muted-foreground">{category}</span>}
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}