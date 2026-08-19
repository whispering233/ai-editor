// 大纲节点伏笔标记徽标（S9.2 大纲页行内渲染；S10.1 起上提为共享组件——
// layout.md §5「跨页复用的纯展示组件上提到 components/ 对应子目录」）
// 数据源：lib/outline-hooks buildNodeHookMarks 聚合的「节点 id → 标记列表」；本组件纯展示
import { CheckCircle2, FastForward, Pin } from "lucide-react";
import type { NodeHookMark } from "../../lib/outline-hooks";

/** 标记类型 → 文案（title tooltip 前缀；hooks.md 生命周期动作：埋下 → 推进 → 回收） */
export const HOOK_MARK_LABEL: Record<NodeHookMark["relationType"], string> = {
  plants: "埋设",
  advances: "推进",
  resolves: "回收",
};

/** 标记类型 → lucide 图标（📌 / ⏩ / ✅ 对应物；样式一律 token 类，禁硬编码色——oracle 红线） */
const HOOK_MARK_ICON: Record<NodeHookMark["relationType"], typeof Pin> = {
  plants: Pin,
  advances: FastForward,
  resolves: CheckCircle2,
};

/**
 * 单个伏笔标记小徽标（紧凑排列）：图标 + 原生 title tooltip 显示伏笔名。
 * 用原生 title 而非 Tooltip 组件：与全页既有 hover 提示模式一致（各操作图标同为 title 属性），
 * 且行/卡容器已有拖拽提示 title——徽标自带 title 可遮蔽父级提示，避免双 tooltip 叠加
 */
export function NodeHookMarkBadge({ mark }: { mark: NodeHookMark }) {
  const Icon = HOOK_MARK_ICON[mark.relationType];
  return (
    <span
      className="shrink-0 rounded px-0.5 text-muted-foreground hover:text-foreground"
      title={`${HOOK_MARK_LABEL[mark.relationType]}伏笔：${mark.hookName}`}
      aria-label={`${HOOK_MARK_LABEL[mark.relationType]}伏笔：${mark.hookName}`}
    >
      <Icon className="size-3" />
    </span>
  );
}
