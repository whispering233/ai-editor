// @whispering233/ai-editor-client 入口（architecture.md：main.tsx 挂载 + App 路由分发）
// 路由表见 doc/ui/layout.md §1（8 路由，#/chat 已移除——聊天常驻右栏 ChatPanel，U2 起不再作为独立页渲染）
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ENTITY_TYPES } from "@whispering233/ai-editor-shared";
import { useHashRoute, type Route } from "./hooks/use-route";
import { AppShell } from "./components/AppShell";
import { ErrorBoundary } from "./components/feedback/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Outline from "./pages/Outline";
import OutlineDetail from "./pages/OutlineDetail";
import Canvas from "./pages/Canvas";
import EntityList from "./pages/EntityList";
import EntityDetail from "./pages/EntityDetail";
import HookPanel from "./pages/HookPanel";
import Timeline from "./pages/Timeline";
import TimelineDetail from "./pages/TimelineDetail";
import Trash from "./pages/Trash";
import Settings from "./pages/Settings";
import "./index.css";

/** 按路由分段渲染页面；未知 hash 已由 useHashRoute 回退 #/ */
function renderPage(route: Route): ReactNode {
  const [first, second, third] = route.segments;
  switch (first) {
    case undefined:
      return <Dashboard />;
    case "outline":
      // S12.2：按段数区分——1 段（#/outline）→ 大纲树；2 段（#/outline/:nodeId）→ 节点详情
      // （二级路由，仿实体详情分支；key = nodeId 变化强制卸载重挂，详情页表单按节点重置）
      return second !== undefined ? <OutlineDetail key={second} nodeId={second} /> : <Outline />;
    case "canvas":
      return <Canvas />;
    case "entities": {
      // 关联 tab（U8，entity-list.md「关联 Tab」）：第 5 个 tab，先于类型归一化拦截——relations 不是实体类型
      if (second === "relations") {
        return <EntityList type="relations" />;
      }
      // 按段数区分：2 段（#/entities/:type）→ 列表；3 段（#/entities/:type/:id）→ 详情（layout.md §1）
      // type 缺省 character（entity-list.md：type ∈ character|setting|location|hook）
      const type =
        second !== undefined && (ENTITY_TYPES as readonly string[]).includes(second)
          ? second
          : "character";
      // key = 实体身份：type/id 变化强制卸载重挂——详情页本地 state（deltaOpen、ComputePreview
      //   result/atNodeId 等）跨实体复用会残留错位（S5.4 审核 M1：关系行跳详情 A→B 用 A 的 result 做 diff）；
      //   重挂同时让 ComputePreview 的 atNodeId 惰性初始化重新读取 currentPosition
      return third !== undefined ? (
        <EntityDetail key={`${type}:${third}`} type={type} id={third} />
      ) : (
        <EntityList type={type} />
      );
    }
    case "hooks":
      return <HookPanel />;
    case "timeline":
      // 按段数区分——1 段（#/timeline）→ 列表页；2 段（#/timeline/:id）→ 事件详情页
      // （timeline.md 路由；key = id 变化强制卸载重挂——详情页表单按事件重置）
      return second !== undefined ? <TimelineDetail key={second} id={second} /> : <Timeline />;
    case "trash":
      return <Trash />;
    case "settings":
      return <Settings />;
    default:
      return <Dashboard />;
  }
}

function App() {
  const route = useHashRoute();
  return <AppShell route={route}>{renderPage(route)}</AppShell>;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root 元素缺失（index.html）");

createRoot(rootEl).render(
  <StrictMode>
    {/* 应用级错误边界（问题 3）：渲染异常不白屏，展示可恢复错误卡（components/feedback/ErrorBoundary.tsx） */}
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
