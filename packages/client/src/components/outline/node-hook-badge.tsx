// 大纲节点伏笔标记徽标（S9.2 大纲页行内渲染；S10.1 起上提为共享组件——
// 「跨页复用的纯展示组件上提到 components/ 对应子目录」）
// 数据源：lib/outline-hooks buildNodeHookMarks 聚合的「节点 id → 标记列表」
// 2026-09：徽标由纯展示改为**导航链接**——点击跳该伏笔详情 `#/hooks/:id`；行级手势不受影响
// （树视图 / 章视图的 click · dblclick 守卫均已排除 `a`，点徽标既不选中行也不进节点详情）
import { CheckCircleFilled, FastForwardFilled, PushpinFilled } from "@ant-design/icons";
import { entityDetailPath } from "../../lib/entity-paths";
import type { NodeHookMark } from "../../lib/outline-hooks";

/** 标记类型 → 文案（title tooltip 前缀；生命周期动作：埋下 → 推进 → 回收） */
export const HOOK_MARK_LABEL: Record<NodeHookMark["relationType"], string> = {
  plants: "埋设",
  advances: "推进",
  resolves: "回收",
};

/** 标记类型 → antd 图标（📌 / ⏩ / ✅ 对应物，统一 Filled（状态类）；样式一律 token 类，禁硬编码色——oracle 红线） */
const HOOK_MARK_ICON: Record<NodeHookMark["relationType"], typeof PushpinFilled> = {
  plants: PushpinFilled,
  advances: FastForwardFilled,
  resolves: CheckCircleFilled,
};

/**
 * 单个伏笔标记小徽标（紧凑排列）：图标 + 原生 title tooltip 显示伏笔名，点击跳该伏笔详情。
 * 用原生 title 而非 Tooltip 组件：与全页既有 hover 提示模式一致（各操作图标同为 title 属性），
 * 且行/卡容器已有拖拽提示 title——徽标自带 title 可遮蔽父级提示，避免双 tooltip 叠加。
 * `draggable={false}`：`a` 默认自带拖拽（拖出即浏览器原生「拖链接」），压掉它才能从徽标处起拖整行
 */
export function NodeHookMarkBadge({ mark }: { mark: NodeHookMark }) {
  const Icon = HOOK_MARK_ICON[mark.relationType];
  const label = `${HOOK_MARK_LABEL[mark.relationType]}伏笔：${mark.hookName}`;
  return (
    <a
      /* 跳伏笔详情；hash 路由 href 必须带 `#`（裸路径会整页导航，同 lib/character-relations 口径） */
      href={`#${entityDetailPath("hook", mark.hookId)}`}
      draggable={false}
      className="shrink-0 rounded px-0.5 text-muted-foreground hover:text-primary hover:underline"
      title={`${label}（点击查看）`}
      aria-label={label}
    >
      <Icon className="text-xs" />
    </a>
  );
}
