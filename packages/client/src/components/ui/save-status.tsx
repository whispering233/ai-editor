// 保存态文案（唯一实现；契约 = docs/ui/DESIGN.md §Components `save-status`）：
// 章正文 / 参考资料 / 练习稿 / 自由练习四处共用，页面只提供状态与时刻，不各写一份 span。
// 四态：`idle` 不渲染、`pending`「编辑中…」（输入即 pending，自动保存防抖期间不得谎报已保存）、
// `saving`「保存中…」、`saved`「已保存 · HH:MM」（时刻 = 最近一次保存**完成**的本地时间）。
// 字号 / 字色沿用 `text-xs text-muted-foreground`，不新增视觉语言。
import { formatSavedAt } from "../../lib/manuscript";

export type SaveState = "idle" | "pending" | "saving" | "saved";

export interface SaveStatusProps {
  state: SaveState;
  /** 最近一次保存完成的本地时刻；`saved` 无时刻 = 无可展示内容（不画半个文案） */
  savedAt?: Date | null;
}

const STATUS_CLASS = "text-xs text-muted-foreground";

export function SaveStatus({ state, savedAt }: SaveStatusProps) {
  if (state === "pending") return <span className={STATUS_CLASS}>编辑中…</span>;
  if (state === "saving") return <span className={STATUS_CLASS}>保存中…</span>;
  if (state === "saved" && savedAt != null) {
    return (
      <span className={`${STATUS_CLASS} tabular-nums`}>已保存 · {formatSavedAt(savedAt)}</span>
    );
  }
  return null; // idle（或 saved 无时刻）：不占位
}
