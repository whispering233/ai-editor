// Settings 设置页：页头（标题）+ 二级 tab 导航（通用 → AI 模型 → 项目规则 → 备份）+ 内容区块
// 布局契约：DESIGN.md §Layout「中栏页头结构」——分割线由 tab 条自带底线承担（`AntdProvider` 的
// `Tabs.horizontalMargin: 0` 保证底线紧贴内容，不留 16px 空档）
// 二级 tab 选中态是**页内 state**，不进 URL（`#/preferences` 恒为设置页；刷新回落默认 tab）——见 DESIGN.md §Components `tabs`
// 各 tab 内容自带数据加载与草稿（antd Tabs 懒渲染：未访问的分区不拉数据、不请求备份列表）
// 「通用」tab 仅桌面版渲染（能力检测 `desktopBridge`；浏览器形态 tab 集合与行为完全不变）
// 跨页意图（卡 6）：左栏「同步云端」在未配置时会置 `pendingSettingsPane`——本页负责切到「备份」tab，
// 再由 `BackupSection` 消费并清空（二级 tab 选中态仍不进 URL）
import { useEffect, useState } from "react";
import { Tabs } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { BackupSection } from "../components/settings/backup-section";
import { LibraryLocationPanel } from "../components/settings/library-location-panel";
import { LlmSection } from "../components/settings/llm-section";
import { ProjectRulesSection } from "../components/settings/project-rules-section";
import { desktopBridge } from "../lib/desktop";
import { useCloudStore } from "../stores/cloud";

/** 二级 tab 键（顺序 = 应用级配置 → 配置 AI → 配置项目 → 数据安全） */
type TabKey = "general" | "llm" | "rules" | "backup";

export default function Settings() {
  const [tab, setTab] = useState<TabKey>("llm");
  /** 跨页意图（卡 6）：只驱动顶层 tab，**不消费**（消费与清空由 `BackupSection` 负责） */
  const pendingPane = useCloudStore((s) => s.pendingSettingsPane);
  const bridge = desktopBridge();

  useEffect(() => {
    if (pendingPane === "cloud") setTab("backup");
  }, [pendingPane]);

  return (
    <section>
      <PageHeader title="设置" divider={false} className="mb-3" />
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          ...(bridge !== null
            ? [{ key: "general", label: "通用", children: <LibraryLocationPanel /> }]
            : []),
          { key: "llm", label: "AI 模型", children: <LlmSection /> },
          { key: "rules", label: "项目规则", children: <ProjectRulesSection /> },
          { key: "backup", label: "备份", children: <BackupSection /> },
        ]}
      />
    </section>
  );
}
