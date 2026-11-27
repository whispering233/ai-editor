// Settings 设置页：页头（标题）+ 二级 tab 导航（通用 → AI 模型 → 项目规则 → 备份 → 快捷键）+ 内容区块
// 布局契约：DESIGN.md §Layout「中栏页头结构」——分割线由 tab 条自带底线承担（`AntdProvider` 的
// `Tabs.horizontalMargin: 0` 保证底线紧贴内容，不留 16px 空档）
// 二级 tab 选中态是**页内 state**，不进 URL（`#/preferences` 恒为设置页；刷新回落默认 tab）——见 DESIGN.md §Components `tabs`
// 各 tab 内容自带数据加载与草稿（antd Tabs 懒渲染：未访问的分区不拉数据、不请求备份列表）
// 「通用」tab 仅桌面版渲染（能力检测 `desktopBridge`；浏览器形态 tab 集合与行为完全不变）
// 跨页意图（卡 6）：左栏「同步云端」在未配置时会置 `pendingSettingsPane`——本页负责切到「备份」tab，
// 再由 `BackupSection` 消费并清空（二级 tab 选中态仍不进 URL）
// 离开守卫：七个二级 tab 里的草稿源各自 `useRegisterDirty(dirty)` 报到，这里聚合「任一脏」；
// 左栏导航与浏览器后退共用同一个 `confirmLeave`（同一次点击 / 后退只弹一次框），见 DESIGN.md `settings-leave-guard`
import { useCallback, useEffect, useRef, useState } from "react";
import { Tabs } from "antd";
import { PageHeader } from "@/components/ui/page-header";
import { BackupSection } from "../components/settings/backup-section";
import { LibraryLocationPanel } from "../components/settings/library-location-panel";
import { LlmSection } from "../components/settings/llm-section";
import { PiConfigSection } from "../components/settings/pi-config-section";
import { ProjectRulesSection } from "../components/settings/project-rules-section";
import { ShortcutsSection } from "../components/settings/shortcuts-section";
import { ZoomPanel } from "../components/settings/zoom-panel";
import { desktopBridge } from "../lib/desktop";
import {
  LeaveGuardContext,
  useLeaveGuard,
  type DirtyReporter,
} from "../hooks/use-leave-guard";
import { useBackGuard } from "../hooks/use-back-guard";
import { confirmLeave } from "../lib/leave-guard";
import { useCloudStore } from "../stores/cloud";
import { useUiStore } from "../stores/ui";

/** 二级 tab 键（顺序 = 应用级配置 → 配置 AI → 配置项目 → 数据安全 → 快捷键说明） */
type TabKey = "general" | "llm" | "advanced" | "rules" | "backup" | "shortcuts";

export default function Settings() {
  const [tab, setTab] = useState<TabKey>("llm");
  /** 跨页意图（卡 6）：只驱动顶层 tab，**不消费**（消费与清空由 `BackupSection` 负责） */
  const pendingPane = useCloudStore((s) => s.pendingSettingsPane);
  const bridge = desktopBridge();

  /** 报到的草稿源（symbol → dirty）；任一存在 = 有未保存修改 */
  const dirtySourcesRef = useRef(new Set<symbol>());
  const [anyDirty, setAnyDirty] = useState(false);
  const reportDirty = useCallback<DirtyReporter>((token, dirty) => {
    const sources = dirtySourcesRef.current;
    if (dirty === sources.has(token)) return; // 重复报到不触发重渲染
    if (dirty) sources.add(token);
    else sources.delete(token);
    setAnyDirty(sources.size > 0);
  }, []);

  /** 真正去问用户那一句（由 lib `confirmLeave` 转发过来，不直接被多个出口调用） */
  async function askBeforeLeave(): Promise<boolean> {
    if (!anyDirty) return true;
    return useUiStore.getState().confirm({
      title: "放弃未保存的修改？",
      description: "设置页有尚未保存的修改，离开后将丢失",
    });
  }
  useLeaveGuard(anyDirty, askBeforeLeave);
  // 后退走 lib 的 confirmLeave（不是本地那份）：两个出口共用一个在途确认，并发时只弹一个框
  useBackGuard(anyDirty, confirmLeave);

  useEffect(() => {
    if (pendingPane === "cloud") setTab("backup");
  }, [pendingPane]);

  return (
    <LeaveGuardContext.Provider value={reportDirty}>
      <section>
        <PageHeader title="设置" divider={false} className="mb-3" />
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as TabKey)}
          items={[
            ...(bridge !== null
              ? [
                  {
                    key: "general",
                    label: "通用",
                    // 两张卡：界面缩放（高频、轻量）在前，书库位置（重操作、会重启）在后
                    children: (
                      <div className="flex flex-col gap-3">
                        <ZoomPanel />
                        <LibraryLocationPanel />
                      </div>
                    ),
                  },
                ]
              : []),
            { key: "llm", label: "AI 模型", children: <LlmSection /> },
            // 「高级」两种形态都渲染：本机级配置五张卡（pi 目录 / 联网搜索 / 自定义模型 / 运行参数 / 配置文件编辑器）
            { key: "advanced", label: "高级", children: <PiConfigSection /> },
            { key: "rules", label: "项目规则", children: <ProjectRulesSection /> },
            { key: "backup", label: "备份", children: <BackupSection /> },
            // 「快捷键」恒在末位：纯说明页（无可交互控件），浏览器与桌面版都渲染
            { key: "shortcuts", label: "快捷键", children: <ShortcutsSection /> },
          ]}
        />
      </section>
    </LeaveGuardContext.Provider>
  );
}
