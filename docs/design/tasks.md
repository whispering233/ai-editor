# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡片 1：统一写作 / 大纲 / 设定三页子栏面板开关图标

- **先读**：`docs/ui/DESIGN.md` 的 `icon-button` / `panel-toggle-icon` / `writing-page` / `outline-page` / `setting-page`（本次已改契约）；以文档为准，不要沿用旧单箭头实现。
- **新增**：`packages/client/src/components/ui/panel-toggle-button.tsx`（4 props：`side` / `collapsed` / `label` / `onToggle`；内部 antd `Button color="default" variant="text" size="small"` + `PanelToggleIcon`；统一生成 `aria-label` / `title` / `aria-expanded`）与 `panel-toggle-button.test.tsx`（SSR；断言 `M9 4 V20` / `M15 4 V20`、`viewBox="0 0 24 24"`、收起/展开文案、`aria-expanded`）。
- **替换 6 处**：`pages/Writing.tsx`（卷章导航栏 / left）、`components/writing/chapter-rail.tsx`（右侧详情 / right）、`pages/Outline.tsx`（大纲树 / left；右侧详情 / right）、`pages/SettingWorkbench.tsx`（设定树 / left）、`components/entity/setting-rail.tsx`（右侧详情 / right）。文案保持 `收起/展开 + 卷章导航栏|大纲树|设定树|右侧详情` 不变。
- **测试同步**：`pages/writing.test.tsx` / `pages/outline.test.tsx` 中面板开关的 `anticon-left/right` 断言改为新组件断言（参考 `components/main-panel/MainToolbar.test.tsx` 的 SVG path 手法）；页面 aria / 位置断言保持。`pages/setting.test.tsx` 只保留 aria / 顺序断言。
- **不做**：主工具栏、宽度 / 收起逻辑、`localStorage` key、URL 行为、树行折叠箭头、其他页面图标。
- **完成判据**：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm lint`、`pnpm typecheck` 全绿；6 处均由 `PanelToggleButton` 渲染；删除本卡；commit（`feat(client): 统一子栏面板开关为 PanelToggleButton`）；`git log -1` 含该 commit 且 `git status` 干净。

### 卡片 2：「全部折叠 / 全部展开」改用树节点图标

- **先读**：`docs/ui/DESIGN.md` 的 `outline-page` / `setting-page` rail header 条目（本次已改为 `NodeCollapseOutlined` / `NodeExpandOutlined`）。
- **替换**：`pages/Outline.tsx` 与 `components/entity/setting-rail.tsx` 的 `MenuFoldOutlined` / `MenuUnfoldOutlined` → `NodeCollapseOutlined` / `NodeExpandOutlined`（含 import）。文案 `全部折叠 / 全部展开` 不变。
- **测试同步**：`pages/setting.test.tsx` 的 `anticon-menu-fold` → `anticon-node-collapse`；`pages/outline.test.tsx` 如有相关断言一并同步。
- **不做**：面板开关（卡片 1）、树行折叠箭头（仍 `RightOutlined` + `rotate-90`）、`MenuFold/Unfold` 的禁用条款。
- **完成判据**：同上三条命令全绿；代码中不再有 `MenuFoldOutlined` / `MenuUnfoldOutlined`；删除本卡；commit（`fix(client): 全部折叠改用树节点图标`）；`git log -1` 含该 commit 且 `git status` 干净。

