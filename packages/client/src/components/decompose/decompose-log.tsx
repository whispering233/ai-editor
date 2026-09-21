// 拆解记录时间线（卡 22.4）：进度页的可折叠区，数据 = `GET /decompose/job/log` 的过程条目。
//
// 契约 = DESIGN.md §拆解小说「拆解记录时间线」：任何 job 状态都渲染、可折叠；每行 `data-row`
// （时刻 + 单行文案 + 可选批徽标）；空态 `caption-text`「暂无过程记录」（会话被删后仍是空态，不回 404）。
// 「只记批表没有的信息」是**服务端**口径（批状态 / 批结果走批列表），本组件只渲染 server 渲染好的单行文案。
// 分层：容器 `Decompose`（状态 + 请求副作用）+ 本 presenter（纯渲染 ⇒ react-dom/server 走查，仓内无 jsdom）。
import { Button, Typography } from "antd";
import type { DecomposeJobLogRes } from "@whispering233/ai-editor-shared";
import { SectionCard } from "../ui/section-card";
import { TypeChip } from "../ui/tag-chip";
import { formatBackupTime } from "../../lib/backup";

export interface DecomposeLogSectionProps {
  entries: DecomposeJobLogRes["entries"];
  /** 展开态（缺省收起：批列表才是主表面，过程条目可能有数百行） */
  expanded: boolean;
  onToggle: () => void;
  /** 拉取失败文案（null = 正常）；失败只降级成本区一行，不炸页面 */
  error: string | null;
}

export function DecomposeLogSection({ entries, expanded, onToggle, error }: DecomposeLogSectionProps) {
  return (
    <SectionCard
      title="拆解记录"
      action={
        <Button size="small" onClick={onToggle} disabled={entries.length === 0}>
          {expanded ? "收起" : "展开"}
        </Button>
      }
    >
      {error !== null ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : entries.length === 0 ? (
        <Typography.Text type="secondary" className="text-xs">
          暂无过程记录
        </Typography.Text>
      ) : expanded ? (
        <ul className="divide-y divide-border rounded-lg border border-border">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 px-3 py-2">
              {/* 时刻复用备份列表的同一格式化（当年 MM-DD HH:mm:ss / 跨年 YY-MM-DD HH:mm:ss） */}
              <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                {formatBackupTime(entry.at)}
              </span>
              <span className="min-w-0 flex-1 text-sm text-foreground">{entry.text}</span>
              {entry.batchSeq !== undefined && (
                <TypeChip className="shrink-0">第 {entry.batchSeq} 批</TypeChip>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </SectionCard>
  );
}
