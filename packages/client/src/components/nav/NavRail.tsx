// 左栏 NavRail（重构，替代原书架树 Sidebar）：
// 顶部标识「书架」（书架主页入口 #/）+ 收起按钮 + 书名按钮（项目概览入口 #/overview）+ 一级导航
// （antd Menu 八项）+ 工具区（回收站）+ 底部设置/主题。书架树/新建/导入/导出/重命名已由书架主页 #/ 承接（1-3/1-3b），
// 会话切换由右栏会话下拉承担——本组件不再持有任何书架数据。
// 无项目打开：书名按钮与业务导航项禁用（引导回顶部「书架」进书架主页，行为平移自旧 TabBar noProject guard）。
// 高亮：路由首段 → Menu key（timepoints 宿主时间轴；**overview 无 Menu 项**——它由书名按钮用选中面表达）；
// 书架路由 #/ 下左栏无选中面（书架自身就是当前页）。
// 主题/色纪律：颜色一律取语义 token 类（bg-background / border-border / bg-accent，均为 index.css 对 antd token 的转发）；
// 禁止内联 style 与硬编码色值（旧版 selected 态用 inline `token.colorPrimaryBg` 已改为 `bg-accent` = `{colors.surface-muted}`）。
// - 底部区「立即备份」/ 设置 / 主题三入口同为无边框文字按钮（DESIGN.md §导航与外壳 `sidebar`：
//   立即备份是动作、形态随底部区，H4 登记例外）；备份在途 `loading` 防连点，无项目禁用。
//   三入口标签一律 `min-w-0 flex-1 truncate text-left`——antd Button 根是 `inline-flex +
//   justify-content: center`，标签不 grow 时「图标 + 文字」会整组居中（用户反馈：底部区要左对齐）。
import { Button, Menu } from "antd";
import { useState } from "react";
import {
  ApartmentOutlined,
  BookOutlined,
  DeleteOutlined,
  DoubleLeftOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  MoonOutlined,
  PushpinOutlined,
  ReadOutlined,
  SaveOutlined,
  SettingOutlined,
  ShareAltOutlined,
  SunOutlined,
  TeamOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { ApiError, CLIENT_NETWORK_ERROR, createProjectBackup } from "../../lib/api";
import type { Route } from "../../hooks/use-route";
import { navigate, useHashRoute } from "../../hooks/use-route";
import { useTheme } from "../../hooks/use-theme";
import { SIDEBAR_MIN_WIDTH } from "../../hooks/use-panels";
import { useProjectStore } from "../../stores/project";
import { useUiStore } from "../../stores/ui";

/** Menu key = 导航目标 path（onClick 直接 navigate(key)）；**「概览」不在列**（入口 = 书名按钮，#/overview） */
const NAV_ITEMS = [
  { key: "/outline", icon: <ApartmentOutlined />, label: "大纲" },
  { key: "/characters", icon: <TeamOutlined />, label: "人物" },
  { key: "/setting", icon: <TagsOutlined />, label: "设定" },
  { key: "/locations", icon: <EnvironmentOutlined />, label: "地点" },
  { key: "/hooks", icon: <PushpinOutlined />, label: "伏笔" },
  { key: "/timeline", icon: <FieldTimeOutlined />, label: "时间轴" },
  { key: "/relations", icon: <ShareAltOutlined />, label: "关联" },
  { key: "/references", icon: <ReadOutlined />, label: "参考资料" },
] as const;

/** 路由 → 导航高亮 key（详情路由同宿主高亮；timepoints 宿主时间轴；#/ 与 #/overview 均无 Menu 项） */
function navKey(route: Route): string | null {
  const first = route.segments[0];
  if (first === undefined || first === "overview") return null;
  if (first === "timepoints") return "/timeline";
  return `/${first}`;
}

export function NavRail({
  width,
  onToggleCollapse,
}: {
  /** 桌面态像素宽度（flex-basis 覆盖默认）；undefined = 小屏默认百分比布局 */
  width?: number;
  /** 收起左栏回调（F7 桌面态由 AppShell 传入；小屏无收起能力） */
  onToggleCollapse?: () => void;
}) {
  const { theme: mode, toggleTheme } = useTheme();
  const config = useProjectStore((s) => s.config);
  const loadError = useProjectStore((s) => s.loadError);
  const showToast = useUiStore((s) => s.showToast);
  const route = useHashRoute();
  /** 立即备份在途（防连点；antd loading 同时拦点击） */
  const [backingUp, setBackingUp] = useState(false);

  /** 立即备份（无名称 = 纯时间戳文件名 `-m` 段；文案与设置页 BackupSection 对齐） */
  async function handleBackupNow() {
    if (config === null || backingUp) return;
    setBackingUp(true);
    try {
      await createProjectBackup();
      showToast("已备份");
    } catch (err) {
      showToast(
        err instanceof ApiError && err.code !== CLIENT_NETWORK_ERROR
          ? err.message
          : "无法连接服务，备份失败",
        "error",
      );
    } finally {
      setBackingUp(false);
    }
  }

  /** 无项目：书名按钮 + 业务导航禁用（引导进顶部「书架」，与旧 TabBar noProject guard 行为一致） */
  const noProject = loadError === "NO_PROJECT_OPEN";
  const selectedKey = navKey(route);
  /** 当前在项目概览页（书名按钮用选中面——概览不再占一级导航位） */
  const atOverview = route.segments[0] === "overview";

  const items = NAV_ITEMS.map((item) => ({
    ...item,
    disabled: noProject,
    // 当前项与项目无关（回收站/概览/大纲等均需项目）——统一禁用
  }));

  return (
    <aside
      className="flex min-w-0 flex-col border-r border-border bg-background"
      style={
        width !== undefined
          ? { flex: `0 1 ${width}px`, minWidth: SIDEBAR_MIN_WIDTH }
          : { flex: "1 1 10%" }
      }
    >
      {/* 顶行：书架入口（点击回书架主页）+ 收起按钮（桌面态） */}
      <div className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-2">
        <a
          href="#/"
          title="回到书架主页"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5"
        >
          <span className="text-primary">◈</span>
          <span className="truncate text-base italic">书架</span>
        </a>
        {onToggleCollapse && (
          <Button
            color="default" variant="text"
            size="small"
            aria-label="收起左栏"
            title="收起左栏"
            // 图标 = 面板折叠同一族镜像对（DESIGN.md `icon-button`）：收起 = `«`（朝本侧边缘）
            icon={<DoubleLeftOutlined />}
            onClick={onToggleCollapse}
          />
        )}
      </div>

      {/* 导航区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 书名按钮（项目概览入口，旁显当前书名；#/overview 路由高亮为选中面——DESIGN.md menu-item-selected） */}
        <Button
          color="default" variant={atOverview ? "filled" : "text"}
          block
          className="mb-1"
          icon={<BookOutlined />}
          disabled={noProject}
          title={noProject ? "先在书架打开一本书" : `打开《${config?.name ?? ""}》概览`}
          onClick={() => navigate("/overview")}
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm">
            {config?.name ?? "概览"}
          </span>
        </Button>

        <Menu
          mode="inline"
          selectedKeys={selectedKey !== null ? [selectedKey] : []}
          items={[
            ...items,
            { type: "divider", key: "divider" },
            // 回收站与创作导航分开（视觉分组，仍为一级项）——两者均需项目，统一禁用
            { key: "/trash", icon: <DeleteOutlined />, label: "回收站", disabled: noProject },
          ]}
          onClick={({ key }) => navigate(key)}
        />
      </div>

      {/* 底部：立即备份 + 设置 + 主题切换（三入口与左栏 Menu 项同级——不受 H4「文字按钮带边框」约束） */}
      <div className="flex shrink-0 flex-col gap-1 border-t border-border px-2 py-2">
        <Button
          color="default" variant="text"
          block
          icon={<SaveOutlined />}
          disabled={config === null}
          loading={backingUp}
          onClick={() => void handleBackupNow()}
        >
          <span className="min-w-0 flex-1 truncate text-left">立即备份</span>
        </Button>
        <Button
          color="default" variant="text"
          block
          icon={<SettingOutlined />}
          onClick={() => navigate("/preferences")}
        >
          <span className="min-w-0 flex-1 truncate text-left">设置</span>
        </Button>
        <Button
          color="default" variant="text"
          block
          icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          {/* 标签 flex-1：antd Button 根为 inline-flex + justify-center，标签不 grow 则「图标+文字」整组居中 */}
          <span className="min-w-0 flex-1 truncate text-left">
            {mode === "dark" ? "浅色模式" : "深色模式"}
          </span>
        </Button>
      </div>
    </aside>
  );
}
