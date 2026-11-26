// 设置页「通用 → 界面缩放」面板（桌面版专属；浏览器形态整张卡不渲染）。
//
// 契约 = `docs/ui/DESIGN.md` `zoom-panel` + `docs/design/50-desktop.md` §4.1「可见性」「设置页控制」：
// 百分比 + 逐档步进 + 端点置灰 +「恢复 100%」。**档位表不存在于客户端**——`percent / atMin / atMax /
// atDefault` 全由主进程给（与菜单同一份端点判定），这里只负责画和派发意图。
// 容器/展示层分离（`ZoomControl` 纯 props）：仓内无 jsdom，测试走 react-dom/server（同 `SearchKeyForm`）。
import { useEffect, useState } from "react";
import { Button } from "antd";
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { SectionCard } from "../ui/section-card";
import { desktopBridge, type ZoomState } from "../../lib/desktop";

/** 缩放意图（与 preload `setZoom` 的入参同源） */
export type ZoomIntent = "in" | "out" | "reset";

/** 展示层：`state === null` = 还没读到（三个按钮全禁用，文案「读取中…」） */
export function ZoomControl({
  state,
  onStep,
}: {
  state: ZoomState | null;
  onStep: (intent: ZoomIntent) => void;
}) {
  const ready = state !== null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        aria-label="缩小界面"
        icon={<MinusOutlined />}
        disabled={!ready || state.atMin}
        onClick={() => onStep("out")}
      />
      {/* 定宽 + 等宽数字：百分比变化时两侧按钮不挪位；aria-live 让读屏用户听到变化 */}
      <span aria-live="polite" className="min-w-12 text-center text-sm tabular-nums">
        {ready ? `${state.percent}%` : "读取中…"}
      </span>
      <Button
        aria-label="放大界面"
        icon={<PlusOutlined />}
        disabled={!ready || state.atMax}
        onClick={() => onStep("in")}
      />
      <Button aria-label="恢复 100%" disabled={!ready || state.atDefault} onClick={() => onStep("reset")}>
        恢复 100%
      </Button>
    </div>
  );
}

export function ZoomPanel() {
  const bridge = desktopBridge();
  const [state, setState] = useState<ZoomState | null>(null);

  useEffect(() => {
    if (bridge === null) return;
    // 推送比挂载读新：读到旧值就别再盖回去（缩放键在挂载瞬间被按下时的竞态）
    let pushed = false;
    const off = bridge.onZoomChanged((next) => {
      pushed = true;
      setState(next);
    });
    void bridge.getZoomState().then((initial) => {
      if (!pushed) setState(initial);
    });
    return off;
  }, [bridge]);

  if (bridge === null) return null;
  return (
    <SectionCard title="界面缩放">
      <ZoomControl state={state} onStep={(intent) => void bridge.setZoom(intent)} />
      <p className="mt-1 text-xs text-muted-foreground">缩放作用于整个界面；正文字号另由写作设置决定。</p>
    </SectionCard>
  );
}
