// @whispering233/ai-editor-client 入口（main.tsx 挂载 + App 路由分发）
// 路由表见 hooks/use-route.ts 的 KNOWN_ROUTE_SEGMENTS（#/chat 已移除——聊天常驻右栏 ChatPanel，U2 起不再作为独立页渲染）
import { StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { navigate, useHashRoute, type Route } from "./hooks/use-route";
import { useEnterLastBook } from "./hooks/use-enter-last-book";
import { workspaceRedirectPath } from "./lib/workspace-route-guard";
import { useProjectStore } from "./stores/project";
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
import AuthorIntro from "./pages/AuthorIntro";
import Works from "./pages/Works";
import StyleNotes from "./pages/StyleNotes";
import Practice from "./pages/Practice";
import PracticeDetail from "./pages/PracticeDetail";
import Free from "./pages/Free";
import FreeDetail from "./pages/FreeDetail";
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
      // 参考资料（卡 12.8）：
      // #/references → 列表；#/references/:id → 详情（编辑态 = 编辑器）；
      // #/references/new → **单一新建入口**（名称 + 可选 URL + 分类 + 标签 + 正文块编辑器）；
      // 旧草稿双路由 #/references/new/md、#/references/new/link（及更深段）重定向到新入口
      if (second === "new") {
        return third === undefined ? (
          <ReferenceDetail draft />
        ) : (
          <RedirectTo to="/references/new" />
        );
      }
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
    case "author":
      // 练习工作区：三张素材页中的作家介绍（只读；数据 = shared 常量，无端点）
      return <AuthorIntro />;
    case "works":
      return <Works />;
    case "style":
      return <StyleNotes />;
    case "practice":
      // 文风练习工作区段，按段数分流：1 段 = 列表页（卡 4）；2 段 = 练习页（卡 10，
      // key = sampleId 变化强制卸载重挂：稿件 / 保存态 / 点评帧消费序号按样本重置）；更深段归回列表
      if (second === undefined) return <Practice />;
      return third === undefined ? (
        <PracticeDetail key={second} sampleId={second} />
      ) : (
        <RedirectTo to="/practice" />
      );
    case "free":
      // 自由练习段，按段数分流：1 段 = 题目列表（卡 5）；2 段 = 该篇详情（key = pieceId 变化强制
      // 卸载重挂：稿件 / 保存态 / 出题与点评帧消费序号按篇重置）；更深段归回列表
      if (second === undefined) return <Free />;
      return third === undefined ? (
        <FreeDetail key={second} pieceId={second} />
      ) : (
        <RedirectTo to="/free" />
      );
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
  // 工作区类型路由守卫（练习工作区只允许自己的页面；UX 守卫，服务端 `requireKind` 才是边界）：
  // **渲染前判定**——被挡下的 hash 只渲染 RedirectTo（它 navigate 后返回 null），**不挂载目标页面**；
  // 挂载后再由 effect 补跳（旧写法，已废止）会让被挡下的页面先打出对面工作区的请求（400）。
  // kind 取自既有项目 store（无第二份状态）：config 未落地时不判定（`workspaceRedirectPath` 收 null）。
  const kind = useProjectStore((s) => s.config?.kind ?? null);
  const redirect = workspaceRedirectPath(kind, route);
  // 首帧直达上次工作区：服务端启动已按创作根 lastProject 打开了上次那个工作区
  //（落点按 kind：小说 → #/overview、练习 → #/practice）
  useEnterLastBook();
  return (
    <AppShell route={route}>
      {redirect === null ? renderPage(route) : <RedirectTo to={redirect} />}
    </AppShell>
  );
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
