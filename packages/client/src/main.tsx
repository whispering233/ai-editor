// @ai-editor/client 入口（architecture.md：main.tsx 挂载 + App 路由分发）
// 路由表见 doc/ui/layout.md §1（9 路由）；本卡为路由骨架，页面内容占位壳，业务在后续切片卡实现
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { ENTITY_TYPES } from "@ai-editor/shared";
import { useHashRoute, type Route } from "./hooks/use-route";
import { AppShell } from "./components/AppShell";
import Dashboard from "./pages/Dashboard";
import Outline from "./pages/Outline";
import Canvas from "./pages/Canvas";
import EntityList from "./pages/EntityList";
import EntityDetail from "./pages/EntityDetail";
import Chat from "./pages/Chat";
import HookPanel from "./pages/HookPanel";
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
      return <Outline />;
    case "canvas":
      return <Canvas />;
    case "entities": {
      // 按段数区分：2 段（#/entities/:type）→ 列表；3 段（#/entities/:type/:id）→ 详情（layout.md §1）
      // type 缺省 character（entity-list.md：type ∈ character|setting|location|hook）
      const type =
        second !== undefined && (ENTITY_TYPES as readonly string[]).includes(second)
          ? second
          : "character";
      return third !== undefined ? <EntityDetail type={type} id={third} /> : <EntityList type={type} />;
    }
    case "chat":
      return <Chat />;
    case "hooks":
      return <HookPanel />;
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
    <App />
  </StrictMode>,
);
