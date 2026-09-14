// 设置页「备份」pane（卡 3 重构）：sub-nav（自动备份 / 云端备份）+ 右侧面板
//
// 布局契约 = docs/ui/DESIGN.md §备份与云端存档 的 `backup-pane`：左 160px 固定两项
//（与设置页「AI 模型」同款 `sub-nav` 契约，复用 `menu-item` / `menu-item-selected` 语言），
// 右侧渲染对应面板；**选中态是页内 state、不进 URL**（刷新回落默认项，与二级 tab 同口径）。
//
// 拆分历史：本文件原为「自动备份」区全部实现，卡 3 拆成三件——
// `backup-section.tsx`（本文件：容器 + 导航）/ `auto-backup-panel.tsx` / `cloud-backup-panel.tsx`。
import { useState } from "react";
import { Menu } from "antd";
import { AutoBackupPanel } from "./auto-backup-panel";
import { CloudBackupPanel } from "./cloud-backup-panel";

/** 面板键（缺省「自动备份」——数据安全的第一落点） */
type BackupPanelKey = "auto" | "cloud";

const PANEL_ITEMS = [
  { key: "auto", label: "自动备份" },
  { key: "cloud", label: "云端备份" },
] as const;

export function BackupSection() {
  const [panel, setPanel] = useState<BackupPanelKey>("auto");

  return (
    <div className="flex gap-4">
      {/* sub-nav（三级导航）：固定两项，160px；宽度由外层容器承载（antd 根元素不挂布局类） */}
      <div className="w-40 shrink-0">
        <Menu
          mode="inline"
          selectedKeys={[panel]}
          onClick={({ key }) => setPanel(key as BackupPanelKey)}
          items={PANEL_ITEMS.map((item) => ({ key: item.key, label: item.label }))}
        />
      </div>

      {/* 面板区：两个面板各自持有数据加载与草稿（未选中的面板不挂载 → 不拉数据） */}
      <div className="min-w-0 flex-1">
        {panel === "auto" ? <AutoBackupPanel /> : <CloudBackupPanel />}
      </div>
    </div>
  );
}
