# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

### 卡片 1：子栏面板开关外端锚定

- **先读**：`docs/ui/DESIGN.md` §Layout「工作台子栏页头」的面板开关口径、`icon-button` 面板开关段、`writing-page`「卷章导航栏」/「宽度与收起」、`outline-page`「rail header」/「宽度与收起」、`setting-page`「rail header」/「宽度与两档收起」（本次已改为外端锚定）。
- **共享页头**：
  - `packages/client/src/components/writing/chapter-rail.tsx`、`packages/client/src/pages/Outline.tsx` 的 `OutlineRail`、`packages/client/src/components/entity/setting-rail.tsx`：加 `leading?: ReactNode` 传给 `PanelHeader`；`insetClassName` 在 `leading` 或 `onToggleDetail` 存在时用 `px-6`，否则保持默认 `px-3`；rail header 注释同步（不再写「左钮不在本栏」）。
  - `packages/client/src/components/manuscript/chapter-editor.tsx`、`packages/client/src/pages/OutlineDetail.tsx`、`packages/client/src/pages/EntityDetail.tsx`：加 `headerActions?: ReactNode`，追加到现有 `PanelHeader` / `PageHeader` 的 `actions` 末尾；详情页头的骨架 / 空态 / 坏 id 形态也要能带。
- **三页分发**（不改两栏互斥约束与 dirty 守卫）：
  - `packages/client/src/pages/Writing.tsx`：两栏都开 → 左钮进 `ChapterRail` 的 `leading`，右钮进正文页头 `actions`；左栏收起 → 左钮进正文页头 `leading`，右钮隐藏；右详情收起 → 右钮进 rail 页头 `actions`，左钮隐藏。`ChapterEditor` 的 `headerLeading` / 新增 `headerActions` 按同一条件传；骨架 / 坏章 / 无章页头同样处理。
  - `packages/client/src/pages/Outline.tsx`：`OutlineRail` 的 `leading` / `onToggleDetail` + 详情页头 `leading` / `actions`；`OutlineDetail` 新增 `headerActions`；无项目 / 加载 / 空态 / 坏 id / 选中五种详情形态都按同一条件带右钮。
  - `packages/client/src/pages/SettingWorkbench.tsx`：`SettingRail` 的 `leading` / `onToggleDetail` + 空态 `PanelHeader` / `EntityDetail` 的 `leading` / `headerActions`。
  - 可见性单源：左钮 `!detailHidden`，右钮 `!railCollapsed`；同一页只渲染一枚左钮、一枚右钮。
- **测试同步**：
  - `packages/client/src/pages/writing.test.tsx`：`收起右侧详情` 从 rail 页头移到正文页头后，原「在左钮之前」断言反转；补两栏都开 / 左栏收起 / 右详情收起三态。
  - `packages/client/src/pages/outline.test.tsx`：右钮位置断言改到详情页头；补左栏收起时左钮在详情页头、右钮隐藏；`#/outline` 空态右钮仍在详情页头。
  - `packages/client/src/pages/setting.test.tsx`：rail 右端组顺序断言改为 `[全部折叠][新建]`，右钮在详情页头；补左栏收起态。
  - `packages/client/src/components/writing/chapter-rail.test.tsx`：把「收起 / 展开入口不在 rail 内」的否定契约改为 `leading` 渲染正例；无 `leading` / 窄屏仍不渲染。
- **不做**：主工具栏整栏开关、`PanelToggleIcon` / `PanelToggleButton` 图标或尺寸、宽度 / 拖拽 / 0px 收起 / `localStorage`、两栏同时收起的策略、顶栏共享页头、48px 窄条。
- **完成后**：删除本卡；commit `feat(client): 子栏面板开关外端锚定`；`git log -1` 含该 commit 且 `git status` 干净。
- **验证**：`pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿 + `git diff --check` 干净；UI 由 `ui-verifier` 独立核三页 × 三态（同一钮点击前后 `x` 不变，截图上限 12 张），worker 不自报 UI PASS。
