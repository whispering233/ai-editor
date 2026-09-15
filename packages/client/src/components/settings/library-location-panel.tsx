// 设置页「通用 → 书库位置」面板（桌面版专属；浏览器形态整个 tab 不渲染）。
//
// 契约（`docs/ui/DESIGN.md` `library-location`）：card + 只读路径 +「更改…」+ 一句说明。
// 「更改」走 preload 桥 → 主进程弹原生目录框 → 写 `<userData>/desktop.json` → 重启应用，
// 因此成功后本页不会再有交互（进程已换新）；取消/选了同一目录返回 null。
import { useEffect, useState } from "react";
import { Button } from "antd";
import { SectionCard } from "../ui/section-card";
import { desktopBridge } from "../../lib/desktop";
import { useUiStore } from "../../stores/ui";

export function LibraryLocationPanel() {
  const bridge = desktopBridge();
  const [root, setRoot] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (bridge === null) return;
    void bridge.getLibraryRoot().then(setRoot);
  }, [bridge]);

  async function handleChange(): Promise<void> {
    if (bridge === null || busy) return;
    setBusy(true);
    try {
      const next = await bridge.changeLibraryRoot();
      // 非 null = 已写配置并触发重启（正常不会走到这里）；null = 取消或未变更
      if (next === null) useUiStore.getState().showToast("未更改书库位置");
    } finally {
      setBusy(false);
    }
  }

  return (
    <SectionCard
      title="书库位置"
      action={
        <Button loading={busy} onClick={() => void handleChange()}>
          更改…
        </Button>
      }
    >
      <p className="truncate text-sm" title={root ?? undefined}>
        {root ?? "读取中…"}
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        书籍、备份与对话历史都存放在这里；更改后应用会自动重启。
      </p>
    </SectionCard>
  );
}
