// @whispering233/ai-editor-client 入口（main.tsx 挂载 + App 路由分发）
// 路由表见 （8 路由，#/chat 已移除——聊天常驻右栏 ChatPanel，U2 起不再作为独立页渲染）
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { navigate, useHashRoute, type Route } from "./hooks/use-route";
import { useEnterLastBook } from "./hooks/use-enter-last-book";
import { AppShell } from "./components/AppShell";
import { AntdProvider } from "./components/AntdProvider";
import { ErrorBoundary } from "./components/feedback/ErrorBoundary";
import Dashboard from "./pages/Dashboard";
import Outline from "./pages/Outline";
import OutlineDetail from "./pages/OutlineDetail";
import EntityList from "./pages/EntityList";
import EntityDetail from "./pages/EntityDetail";
import CharacterWorkbench from "./pages/CharacterWorkbench";
import HookPanel from "./pages/HookPanel";
import Timeline from "./pages/Timeline";
import TimelineDetail from "./pages/TimelineDetail";
import ReferenceList from "./pages/ReferenceList";
import ReferenceDetail from "./pages/ReferenceDetail";
import Manuscript from "./pages/Manuscript";
import Trash from "./pages/Trash";
import Settings from "./pages/Settings";
import "./index.css";

/** 旧路由重定向（路由一级化；hash 不出浏览器，服务端零感知）
 * 实体家族旧址 → 新一级段；#/settings → #/preferences（设置页避让设定 #/setting） */
function RedirectTo({ to }: { to: string }) {
  useEffect(() => {
    navigate(to);
  }, [to]);
  return null;
}

/** 实体类型旧段 → 新一级段（含历史别名 setting-tree；泛型详情统一丢 id 保详情） */
const LEGACY_ENTITY_SEGMENT: Record<string, string> = {
  character: "characters",
  setting: "setting",
  "setting-tree": "setting",
  location: "locations",
  relations: "relations",
  hook: "hooks",
  event: "timeline",
  timepoint: "timepoints",
  reference: "references",
};

/** 按路由分段渲染页面；未知 hash 已由 useHashRoute 回退 #/ */
function renderPage(route: Route): ReactNode {
  const [first, second, third] = route.segments;
  switch (first) {
    case undefined:
      return <Dashboard mode="home" />;
    case "overview":
      return <Dashboard mode="overview" />;
    case "outline":
      // S12.2：按段数区分——1 段（#/outline）→ 大纲树；2 段（#/outline/:nodeId）→ 节点详情
      // （二级路由，仿实体详情分支；key = nodeId 变化强制卸载重挂，详情页表单按节点重置）
      return second !== undefined ? <OutlineDetail key={second} nodeId={second} /> : <Outline />;
    case "entities": {
      // 实体家族一级化——旧 #/entities/:type[/:id] 全量重定向到新段
      // （泛型列表入口已移除的 hook/event/timepoint/reference：丢/带 id 落宿主详情段）
      const seg = LEGACY_ENTITY_SEGMENT[second ?? ""] ?? "characters";
      const carryId = third !== undefined && second !== undefined && second !== "relations";
      return <RedirectTo to={carryId ? `/${seg}/${third}` : `/${seg}`} />;
    }
    case "characters":
      // 人物工作台（卡 3.1）：master-detail——左栏 = 人物列表本身（不再有独立列表页），
      // 两个子路由都走同一宿主（只传 id；工作台在 #/characters 无 id 时推导选中后重定向）
      return <CharacterWorkbench id={second} />;
    case "setting":
      // 设定段 = 树形视图列表（#/setting）+ 详情（#/setting/:id）
      return second !== undefined ? (
        <EntityDetail key={`setting:${second}`} type="setting" id={second} />
      ) : (
        <EntityList type="setting" />
      );
    case "locations":
      return second !== undefined ? (
        <EntityDetail key={`location:${second}`} type="location" id={second} />
      ) : (
        <EntityList type="location" />
      );
    case "relations":
      // 关联总览（无详情路由；更深段归一回 /relations）
      return second !== undefined ? (
        <RedirectTo to="/relations" />
      ) : (
        <EntityList type="relations" />
      );
    case "hooks":
      // 富页（#/hooks）+ 详情（#/hooks/:id——承接旧泛型 hook 详情，实体关系泛型入口已移除）
      return second !== undefined ? (
        <EntityDetail key={`hook:${second}`} type="hook" id={second} />
      ) : (
        <HookPanel />
      );
    case "timepoints":
      // 时间点无列表导航（管理在时间轴页）；详情段承接旧泛型时间点详情（时间轴行双击进入）
      return second !== undefined ? (
        <EntityDetail key={`timepoint:${second}`} type="timepoint" id={second} />
      ) : (
        <RedirectTo to="/timeline" />
      );
    case "timeline":
      // 按段数区分——1 段（#/timeline）→ 列表页；2 段（#/timeline/:id）→ 事件详情页
      // （路由；key = id 变化强制卸载重挂——详情页表单按事件重置）
      return second !== undefined ? <TimelineDetail key={second} id={second} /> : <Timeline />;
    case "references":
      // 参考资料（卡 11.4）：
      // #/references → 列表；#/references/:id → 详情（编辑态）；
      // #/references/new/md → 新建 md 文档草稿态；#/references/new/link → 新建外源链接草稿态
      if (second === "new" && third === "md") return <ReferenceDetail draft="md" />;
      if (second === "new" && third === "link") return <ReferenceDetail draft="link" />;
      return second !== undefined ? (
        <ReferenceDetail key={second} id={second} />
      ) : (
        <ReferenceList />
      );
    case "manuscript":
      // 章正文页（卡 12.5）：#/manuscript/:chapterId——缺章 id 或多余段归一回大纲页
      // （key = chapterId 变化强制卸载重挂：正文按章重置、在途自动保存 flush）
      return second !== undefined && third === undefined ? (
        <Manuscript key={second} chapterId={second} />
      ) : (
        <RedirectTo to="/outline" />
      );
    case "trash":
      return <Trash />;
    case "preferences":
      return <Settings />;
    case "settings":
      // 旧设置页路由（设置页避让设定 #/setting → #/preferences）
      return <RedirectTo to="/preferences" />;
    default:
      return <Dashboard mode="home" />;
  }
}

function App() {
  const route = useHashRoute();
  // 首帧直达上次书籍：服务端启动已按创作根 lastProject 打开上次那本书 → 书架路由直接进概览
  useEnterLastBook();
  return <AppShell route={route}>{renderPage(route)}</AppShell>;
}

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("#root 元素缺失（index.html）");

createRoot(rootEl).render(
  <StrictMode>
    {/* 应用级错误边界（问题 3）：渲染异常不白屏，展示可恢复错误卡（components/feedback/ErrorBoundary.tsx） */}
    <ErrorBoundary>
      {/* antd 根 Provider：zhCN + 默认色板双算法，主题跟随 html.dark */}
      <AntdProvider>
        <App />
      </AntdProvider>
    </ErrorBoundary>
  </StrictMode>,
);
