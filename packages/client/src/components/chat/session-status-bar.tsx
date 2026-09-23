// 会话状态栏（DESIGN.md `session-status-bar`）：输入区（Sender → 配置行 → 状态栏）最底一行只读观测层。
// 数字全部由服务端算好下发（口径 = docs/design/20-context.md §2.1），本组件只渲染 lib/session-status.ts
// 组装好的视图：一行 caption 字号 + tabular-nums、无底色 / 无描边 / 无图标、hover 走原生 title（多行）。
// 窄栏自适应 = 容器查询声明式隐藏（不足先隐累计 tokens、再隐缓存段；不折行、不 JS 测宽）——
// 面板宽 ≠ 视口，media query 不可替代；类字面量只能写在这里（Tailwind 只扫字面量类名，不能拼常量），
// 阈值数值唯一定义处 = lib/session-status.ts（同值断言见 lib/session-status.test.ts）。
import { theme } from "antd";
import { useChatStore } from "../../stores/chat";
import {
  contextBarColor,
  sessionStatusView,
  type SessionStatusSegmentKey,
  type SessionStatusView,
} from "../../lib/session-status";

/** 两级窄栏隐藏：段键 → 容器查询类（阈值 = lib 的 STATUS_NARROW_WIDTH / STATUS_CRAMPED_WIDTH） */
const NARROW_HIDE_CLASS: Partial<Record<SessionStatusSegmentKey, string>> = {
  total: "@max-[420px]:hidden",
  cache: "@max-[340px]:hidden",
};

/**
 * 展示组件（导出供 SSR 走查：zustand 的 getServerSnapshot 恒为初始态，store 数据在 SSR 看不到）：
 * 容器 = 本行自身（`@container`），宽度不足时按 `NARROW_HIDE_CLASS` 声明式隐藏，永不折行。
 */
export function SessionStatusBarView({ view }: { view: SessionStatusView }) {
  const { token } = theme.useToken();
  return (
    <div
      title={view.title}
      className="@container mt-1 flex items-center gap-x-3 overflow-hidden text-xs text-muted-foreground whitespace-nowrap tabular-nums"
    >
      {view.context !== null && (
        <span className="flex shrink-0 items-center gap-1.5">
          {view.context.percent !== null && (
            <span className="block h-0.5 w-16 overflow-hidden rounded-full bg-accent">
              <span
                className="block h-full rounded-full"
                style={{
                  width: `${view.context.percent}%`,
                  background: token[contextBarColor(view.context.percent)],
                }}
              />
            </span>
          )}
          <span>{view.context.text}</span>
        </span>
      )}
      {view.segments.map((segment) => (
        <span key={segment.key} className={NARROW_HIDE_CLASS[segment.key]}>
          {segment.text}
        </span>
      ))}
    </div>
  );
}

/** 状态栏：usage / 占用段 / speed 全为空 → 不渲染 */
export function SessionStatusBar() {
  const contextUsage = useChatStore((s) => s.contextUsage);
  const usage = useChatStore((s) => s.usage);
  const speed = useChatStore((s) => s.speed);
  const view = sessionStatusView({ contextUsage, usage, speed });
  return view === null ? null : <SessionStatusBarView view={view} />;
}
