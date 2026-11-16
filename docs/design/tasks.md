# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### T1 中栏信息条改为工具栏（InfoBar → MainToolbar）

- **目标**：中栏顶部改为纯工具栏，删除品牌标记、项目名、阅读进度、语言；桌面 = 左栏 toggle + 刷新 + 右栏 toggle，窄屏 = 刷新 + 聊天开关；`novel` / `practice` 同形。契约已更新 = `docs/ui/DESIGN.md` §Components `main-toolbar` / `app-mark`、§Layout 专注模式。
- **改动**：
  - `git mv components/main-panel/InfoBar.tsx → components/main-panel/MainToolbar.tsx`：组件改名 `MainToolbar`（`PanelToggles` 接口随文件导出）；删除 `AppMark` / `findOutlineNodeTitle` / `useProjectStore` / `setFocusOutlineNode` 依赖与项目信息 JSX；保留桌面两枚 toggle、刷新（`ml-auto`）、窄屏聊天开关；根 `h-12 … border-b border-border px-4` 不变。
  - `git mv components/main-panel/InfoBar.test.tsx → MainToolbar.test.tsx`：改为 `MainToolbar` 断言——无项目名 / 阅读进度 / 语言 / `<svg>` / `#/overview` / `#/outline`；桌面按钮顺序 = 左 toggle → 刷新 → 右 toggle；窄屏无面板图形、有聊天开关；保留 react-dom/server 手法，不再注入 `useProjectStore`。
  - `components/main-panel/MainPanel.tsx`：import / render / 注释改 `MainToolbar`；`loadConfig` 仍供悬浮「问 AI」判可用，不再为标题。
  - 全仓当前行为注释 `InfoBar` / `info-bar` → `MainToolbar` / `main-toolbar`（**不改 CHANGELOG 历史版本条目**）；至少覆盖 `AppShell.tsx`、`NavRail.tsx`、`brand/app-mark.tsx`（落点一处）、`hooks/use-panels.ts`、`hooks/use-data-refresh.ts`、`chat/ChatPanel.tsx`、`ui/panel-toggle-icon.tsx`、`ui/page-header.tsx`、`stores/ui.ts`、`lib/current-position.ts`、`lib/workspace-route-guard.ts`，以及各页 `dataVersion` 注释（Dashboard / Outline / OutlineDetail / EntityList / EntityDetail / HookPanel / Timeline / TimelineDetail / Trash / Free / Practice / CharacterWorkbench）与 `cloud-backup-panel.test.tsx` / `stats-hud.test.tsx` 的「同 InfoBar.test」注释。
- **边界**：不改 `docs/`（主会话已按 A 方案更新；发现矛盾先停下报告）；不新增工具按钮、不上提页头操作、不改高度 / 分组 / 响应式；不动后端 / API / db；左栏书名按钮、概览页阅读进度链接、`focusOutlineNodeId` 机制保持不变。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test`；浏览器 / SSR 检查桌面工具栏 3 枚按钮且无文本信息、窄屏 2 枚按钮、两种 kind 同形。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
