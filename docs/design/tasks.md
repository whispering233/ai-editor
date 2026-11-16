# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### R2 整栏 toggle 迁入 InfoBar + `PanelToggleIcon`

- **目标**：左右栏收起/展开从 `NavRail` / `ChatPanel` 栏内迁到 `info-bar` 两端；收起态 = 0px（无窄条、无占位）；新增自绘静态面板图标。
- **改动**：
  - 新增 `packages/client/src/components/ui/panel-toggle-icon.tsx`（`side: "left" | "right"`；inline SVG、`currentColor`、圆角矩形 + 内侧竖线、24 viewBox / 显示 16px、约 1.8 stroke；`aria-hidden`；无尺寸/色值 API）。
  - `components/main-panel/InfoBar.tsx`：左端 `side="left"` 放项目名前，右端 `side="right"` 放语言后；仅 `isDesktop` 渲染；`icon-button`；动态 `aria-label` / `title` / `aria-expanded`（`收起左栏` / `展开左栏`、`收起右栏` / `展开右栏`）；不加选中面；不新增 antd Tooltip。新增 `panelToggles` 对象 prop。
  - `components/main-panel/MainPanel.tsx`、`components/AppShell.tsx`：透传 `panelToggles`；桌面收起态不渲染对应栏（0px），拖拽手柄仅展开态渲染；窄屏行为不变。
  - `components/nav/NavRail.tsx` / `components/chat/ChatPanel.tsx`：删除 `onToggleCollapse` prop 与栏内收起按钮（含 `ChatPanelBody` / `SessionTitleBar` 三层透传）；保留移动端 `onClose`。
  - `components/main-panel/InfoBar.test.tsx`：补新 prop、左右按钮、窄屏隐藏断言。
- **边界**：R2 **不要删除** `components/ui/collapse-strip.tsx`（R3 还要移除写作页最后一个 `grip` 用法）；不改 `docs/`；不改写作页。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test`；浏览器 1440 / 1024 两档看左右栏收起/展开、0px、按钮两端位置、tooltip/aria、窄屏无新按钮、无 32px 占位。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

### R3 写作页卷章栏 0 宽 + 页头 toggle

- **目标**：写作页卷章栏收起 = 0px；收起/展开入口迁到正文列页头标题行最左；删除右边线中缝圆钮。
- **改动**：
  - `components/ui/page-header.tsx`：新增 `leading?: ReactNode`，渲染在标题行最左（`titleNode` / title 之前，`action` 仍靠右）。
  - `components/manuscript/chapter-editor.tsx`：新增 `headerLeading?: ReactNode` 并透传 `PageHeader` 的 `leading`。
  - `pages/Writing.tsx`：删除 `CollapseStrip` 渲染；`railCollapsed` 时不渲染 rail；同一枚 `railToggle`（桌面 + 非专注；`aria-label` / `title` = `收起卷章导航栏` / `展开卷章导航栏`，`aria-expanded`；图标当前点击动作：收起 `LeftOutlined`、展开 `RightOutlined`；普通 `icon-button`，不是圆钮）传给四种正文形态（骨架 / 显式坏章 / 正文 / 桌面无章）。
  - `components/writing/chapter-rail.tsx`：删除 `onCollapse` prop、绝对定位圆钮及包裹层；保留 `border-r` 与 6px 拖拽手柄。
  - `pages/writing.test.tsx`：删 32px 窄条 / 中线圆钮断言，补 0px、页头 toggle、窄屏 / 专注无 toggle。
  - 收尾：删除 `components/ui/collapse-strip.tsx`（确认无消费者后）。
- **边界**：不改 `docs/`；不改大纲页；宽度 / 拖拽区间 / `ai-editor:writing-rail` 持久化语义不变。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test`；浏览器 1440 / 1024 看 rail 展开/收起、0px、页头 toggle 位置、窄屏 / 专注无 toggle、展开恢复原宽。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

### R1 大纲层级徽标双色（卷红褐 / 章·场软灰）

- **目标**：卷 = 现有红褐 `type-badge-border`；章 / 场 = 新增 `type-badge-border-soft`；同一枚「章」全站一色。
- **改动**：
  - `index.css`：新增 `--type-badge-border-soft`（浅 `#787671` / 深 `rgba(255,255,255,.51)`）与 Tailwind 映射 `--color-type-badge-border-soft`。
  - `components/ui/tag-chip.tsx`：新增 `tone?: "default" | "soft"`，默认不变；`soft` 只换边框类。
  - 调用点：`pages/Outline.tsx`（树行 + 就地新建行，卷 default、章/场 soft）、`components/writing/chapter-rail.tsx`（卷 default、章 soft）、`pages/OutlineDetail.tsx:295`（卷 default、章/场 soft）、`pages/Trash.tsx` 的 `TypeBadge`（实体 default；节点卷 default、章/场 soft）。
  - `components/ui/tag-chip.test.tsx`：补 `tone="soft"` 断言，默认红褐不变。
- **边界**：不改 `docs/`；`阅读进度` / `推演节点` 状态徽标与其它枚举 `TypeChip` 保持默认红；不新增第三种彩色。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test`；浏览器浅 / 深色各看大纲树、写作页卷章栏、节点详情、回收站节点栏；软灰边框在两态均可见，卷仍红褐。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
