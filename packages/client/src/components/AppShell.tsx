// 应用外壳（doc/ui/layout.md §0/§2）：三栏装配——左栏 Sidebar + 中栏 MainPanel + 右栏 ChatPanel
// 宽度严格 1:5:4 百分比（flex-basis 10%/50%/40%），左右栏固定不可拖拽；
// <1024px 右栏折叠为抽屉：open 状态在此持有（开关在信息条右侧，抽屉渲染在 ChatPanel）
import { useState, type ReactNode } from "react";
import type { Route } from "../hooks/use-route";
import { ChatPanel } from "./chat/ChatPanel";
import { MainPanel } from "./main-panel/MainPanel";
import { Sidebar } from "./sidebar/Sidebar";

export function AppShell({ route, children }: { route: Route; children: ReactNode }) {
  // 小屏抽屉开关状态（桌面态恒显示静态右栏，该状态不生效）
  const [chatOpen, setChatOpen] = useState(false);

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <MainPanel route={route} chatOpen={chatOpen} onToggleChat={() => setChatOpen((v) => !v)}>
        {children}
      </MainPanel>
      <ChatPanel open={chatOpen} onClose={() => setChatOpen(false)} />
    </div>
  );
}
