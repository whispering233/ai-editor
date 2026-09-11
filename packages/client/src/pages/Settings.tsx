// Settings 设置页：页头（标题）+ 二级 tab 导航（AI 模型 → 项目规则 → 备份）+ 内容区块
// 布局契约：DESIGN.md §Layout「中栏页头结构」——分割线由 tab 条自带底线承担（`AntdProvider` 的
// `Tabs.horizontalMargin: 0` 保证底线紧贴内容，不留 16px 空档）
// 二级 tab 选中态是**页内 state**，不进 URL（`#/preferences` 恒为设置页；刷新回落默认 tab）——见 DESIGN.md §Components `tabs`
// 各 tab 内容自带数据加载与草稿（antd Tabs 懒渲染：未访问的分区不拉数据、不请求备份列表）
import { useState } from "react";
import { Tabs } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { BackupSection } from "../components/settings/backup-section";
import { LlmSection } from "../components/settings/llm-section";
import { ProjectRulesSection } from "../components/settings/project-rules-section";

/** 二级 tab 键（顺序 = 配置 AI → 配置项目 → 数据安全） */
type TabKey = "llm" | "rules" | "backup";

export default function Settings() {
  const [tab, setTab] = useState<TabKey>("llm");

  return (
    <section>
      <PageHeader title="设置" divider={false} className="mb-3" />
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: "llm", label: "AI 模型", children: <LlmSection /> },
          { key: "rules", label: "项目规则", children: <ProjectRulesSection /> },
          { key: "backup", label: "备份", children: <BackupSection /> },
        ]}
      />
    </section>
  );
}
