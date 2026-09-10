// 左栏 NavRail（批次十七 1-2 重构，替代原书架树 Sidebar）：
// 顶部标识（收起按钮）+ 回到书架按钮（旁显当前书名，#/）+ 一级导航（antd Menu 九项）+
// 工具区（回收站）+ 底部设置/主题。书架树/新建/导入/导出/重命名已由书架主页 #/ 承接（1-3/1-3b），
// 会话切换由右栏会话下拉承担——本组件不再持有任何书架数据。
// 无项目打开：业务导航项禁用（引导回书架主页，行为平移自旧 TabBar noProject guard）。
// 高亮：路由首段 → Menu key（timepoints 宿主时间轴）；书架按钮在 #/ 路由高亮。
// 主题/色纪律：底色与分隔线取 antd token（useToken）——随 ConfigProvider 双算法切换，
// 过渡期不与旧 Tailwind token 类混用（颜色一律 antd token；布局 Tailwind utility 不含色）。
import { theme, Button, Menu, Typography } from "antd";
import {
  ApartmentOutlined,
  BookOutlined,
  DashboardOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  MenuFoldOutlined,
  MoonOutlined,
  PushpinOutlined,
  ReadOutlined,
  SettingOutlined,
  ShareAltOutlined,
  SunOutlined,
  TeamOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import type { Route } from "../../hooks/use-route";
import { navigate, useHashRoute } from "../../hooks/use-route";
import { useTheme } from "../../hooks/use-theme";
import { SIDEBAR_MIN_WIDTH } from "../../hooks/use-panels";
import { useProjectStore } from "../../stores/project";

/** Menu key = 导航目标 path（onClick 直接 navigate(key)） */
const NAV_ITEMS = [
  { key: "/overview", icon: <DashboardOutlined />, label: "概览" },
  { key: "/outline", icon: <ApartmentOutlined />, label: "大纲" },
  { key: "/characters", icon: <TeamOutlined />, label: "人物" },
  { key: "/setting", icon: <TagsOutlined />, label: "设定" },
  { key: "/locations", icon: <EnvironmentOutlined />, label: "地点" },
  { key: "/hooks", icon: <PushpinOutlined />, label: "伏笔" },
  { key: "/timeline", icon: <FieldTimeOutlined />, label: "时间轴" },
  { key: "/relations", icon: <ShareAltOutlined />, label: "关联" },
  { key: "/references", icon: <ReadOutlined />, label: "参考资料" },
] as const;

/** 路由 → 导航高亮 key（详情路由同宿主高亮；timepoints 宿主时间轴；#/ 无 Menu 项） */
function navKey(route: Route): string | null {
  const first = route.segments[0];
  if (first === undefined) return null;
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
  const { token } = theme.useToken();
  const { theme: mode, toggleTheme } = useTheme();
  const config = useProjectStore((s) => s.config);
  const loadError = useProjectStore((s) => s.loadError);
  const route = useHashRoute();

 /** 无项目：业务导航禁用（引导回书架主页 #/，与旧 TabBar noProject guard 行为一致） */
  const noProject = loadError === "NO_PROJECT_OPEN";
  const selectedKey = navKey(route);
  const atHome = route.segments.length === 0;

  const items = NAV_ITEMS.map((item) => ({
    ...item,
    disabled: noProject,
    // 当前项与项目无关（回收站/概览/大纲等均需项目）——统一禁用
  }));

  return (
    <aside
      className="flex min-w-0 flex-col"
      style={{
        background: token.colorBgContainer,
        borderRight: `1px solid ${token.colorSplit}`,
        ...(width !== undefined
          ? { flex: `0 1 ${width}px`, minWidth: SIDEBAR_MIN_WIDTH }
          : { flex: "1 1 10%" }),
      }}
    >
      {/* 顶行：产品标识（点击回书架主页）+ 收起按钮（桌面态） */}
      <div
        className="flex h-12 shrink-0 items-center gap-1 px-2"
        style={{ borderBottom: `1px solid ${token.colorSplit}` }}
      >
        <a
          href="#/"
          title="回到书架主页"
          className="flex min-w-0 flex-1 items-center gap-1.5 rounded-md px-2 py-1.5"
        >
          <span style={{ color: token.colorPrimary }}>◈</span>
          <Typography.Text italic className="truncate text-base">
            我的小说
          </Typography.Text>
        </a>
        {onToggleCollapse && (
          <Button
            type="text"
            size="small"
            aria-label="收起左栏"
            title="收起左栏"
            icon={<MenuFoldOutlined />}
            onClick={onToggleCollapse}
          />
        )}
      </div>

      {/* 导航区 */}
      <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
        {/* 回到书架按钮（旁显当前书名；#/ 路由高亮） */}
        <Button
          type="text"
          block
          className="mb-1 h-9 justify-start rounded-md px-2"
          icon={<BookOutlined />}
          onClick={() => navigate("/")}
          style={
            atHome
              ? { background: token.colorPrimaryBg, color: token.colorPrimary }
              : undefined
          }
        >
          <span className="min-w-0 flex-1 truncate text-left text-sm" title="回到书架主页">
            {config?.name ?? "书架"}
          </span>
        </Button>

        <Menu
          mode="inline"
          selectedKeys={selectedKey !== null ? [selectedKey] : []}
          items={[
            ...items,
            // 工具区分隔：回收站与创作导航分开（视觉分组，仍为一级项）
            { type: "divider", key: "divider" },
            { key: "/trash", icon: <DeleteOutlined />, label: "回收站", disabled: noProject },
          ]}
          onClick={({ key }) => navigate(key)}
        />
      </div>

      {/* 底部：设置 + 主题切换 */}
      <div
        className="flex shrink-0 flex-col gap-1 px-2 py-2"
        style={{ borderTop: `1px solid ${token.colorSplit}` }}
      >
        <Button
          type="text"
          block
          className="h-8 justify-start rounded-md px-2"
          icon={<SettingOutlined />}
          onClick={() => navigate("/preferences")}
        >
          <span className="truncate text-left">设置</span>
        </Button>
        <Button
          type="text"
          block
          className="h-8 justify-start rounded-md px-2"
          icon={mode === "dark" ? <SunOutlined /> : <MoonOutlined />}
          onClick={toggleTheme}
          aria-label="切换主题"
        >
          <span className="truncate text-left">{mode === "dark" ? "浅色模式" : "深色模式"}</span>
        </Button>
      </div>
    </aside>
  );
}
