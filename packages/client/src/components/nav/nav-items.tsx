// 左栏按工作区类型（`kind`）渲染的**唯一常量表**（DESIGN.md §导航与外壳「左栏按工作区类型渲染」）。
//
// 为什么是一张常量表而不是插件式注册表：新增工作区类型是「加一条 `kind`」（全量 = shared
// `WORKSPACE_DIRS` 键集），项集是产品决定、不是可扩展点；`Record<WorkspaceKind, NavRailSpec>`
// 让「加了 kind 忘了项集」在类型检查期就暴露。
// 图标一律 `@ant-design/icons`（导航用 Outlined，见 DESIGN.md `icon-button` 的图标纪律）。
import type { ReactNode } from "react";
import {
  ApartmentOutlined,
  DeleteOutlined,
  EnvironmentOutlined,
  FieldTimeOutlined,
  FormOutlined,
  PushpinOutlined,
  ReadOutlined,
  ShareAltOutlined,
  TagsOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import type { WorkspaceKind } from "@whispering233/ai-editor-shared";

/** 一级导航项：`key` = 导航目标 path（= antd Menu key，点击直接 navigate(key)） */
export interface NavItemSpec {
  key: string;
  icon: ReactNode;
  label: string;
}

/** 一种工作区类型的左栏形态 */
export interface NavRailSpec {
  /** 顶部标识文案（`#/` 根首页入口）：小说 = 书架、练习 = 文风练习 */
  brandLabel: string;
  /** 一级导航项（顺序 = 渲染顺序） */
  items: readonly NavItemSpec[];
  /** 工具区（回收站）是否渲染——回收站是小说语义（练习数据物理删，无回收站概念） */
  trash: boolean;
  /** 书名按钮（`#/overview` 项目概览入口）是否渲染——练习工作区没有项目概览页 */
  projectOverview: boolean;
}

/** 回收站项（工具区；与创作导航之间在 `NavRail` 里插一条分隔线） */
export const TRASH_ITEM: NavItemSpec = { key: "/trash", icon: <DeleteOutlined />, label: "回收站" };

/** kind → 左栏形态（「概览」不占一级导航位：入口是书名按钮） */
export const NAV_RAIL_BY_KIND: Record<WorkspaceKind, NavRailSpec> = {
  novel: {
    brandLabel: "书架",
    items: [
      { key: "/outline", icon: <ApartmentOutlined />, label: "大纲" },
      { key: "/characters", icon: <TeamOutlined />, label: "人物" },
      { key: "/setting", icon: <TagsOutlined />, label: "设定" },
      { key: "/locations", icon: <EnvironmentOutlined />, label: "地点" },
      { key: "/hooks", icon: <PushpinOutlined />, label: "伏笔" },
      { key: "/timeline", icon: <FieldTimeOutlined />, label: "时间轴" },
      { key: "/relations", icon: <ShareAltOutlined />, label: "关联" },
      { key: "/references", icon: <ReadOutlined />, label: "参考资料" },
    ],
    trash: true,
    projectOverview: true,
  },
  practice: {
    brandLabel: "文风练习",
    // 练习工作区的一级导航只有它自己（顶部标识回根首页 `#/`，底部四入口保持不变）
    items: [{ key: "/practice", icon: <FormOutlined />, label: "文风练习" }],
    trash: false,
    projectOverview: false,
  },
};
