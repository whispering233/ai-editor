# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### 卡 A：分栏边线单所有权（消除外壳双竖线）

**背景**：用户报「左侧导航栏和左栏之间有两条竖线，人物 tab 也有」。根因 = 交界处有两个画线者：`NavRail` 的 `border-r`（`components/nav/NavRail.tsx`）与 6px `ResizeHandle` 内层常显中线（`components/ui/resize-handle.tsx` 的 `absolute inset-y-0 left-1/2 w-px bg-border/60`），相距约 3px。契约已改：`docs/ui/DESIGN.md` §Layout「分栏边线单所有权（2026-11）」+ §Layout「写作页的中栏内分栏」+ `writing-page`「宽度与收起」。

**改动范围（只这些）**
1. `packages/client/src/components/ui/resize-handle.tsx`：删掉内层常显中线 `div`；保留 6px 热区、`hover:bg-border` / `active && bg-border` 半透明带与 `HolderOutlined` hover 提示；头部注释改为「不画线，线归面板」。
2. `packages/client/src/components/writing/chapter-rail.tsx`：`aside` 改为自带 `border-r border-border`（与人物栏 `character-rail.tsx` 同写法，`cn` 合并 `className` 覆盖）；删掉「不自带右边线」那条注释，改成「展开态分栏线归本栏；窄屏全宽由页面传 `border-r-0`」。
3. `packages/client/src/pages/Writing.tsx`：给 `<ChapterRail>` 传 `className={isDesktop ? undefined : "w-full border-r-0"}`（窄屏全宽不留右边线；与 `CharacterWorkbench` 的桌面判断同口径）。
4. 测试跟随：`components/writing/chapter-rail.test.tsx:71` 与 `pages/writing.test.tsx:235` 的「无右边线」断言改为「桌面展开态有 `border-r border-border`，窄屏渲染里出现 `border-r-0` 且不含 `border-r border-border`」；`resize-handle` 若有无中线断言可补一条（渲染 HTML 不含 `bg-border/60`）。

**不做**：不动 `NavRail` / `ChatPanel` 的边线（它们要覆盖抽屉与窄屏）；不动手柄 6px 宽度与 drag 行为；不碰卡 B（中缝圆钮）。

**验收（硬判据）**
- `pnpm --filter @whispering233/ai-editor-client test` 全绿；`pnpm typecheck`、`pnpm lint` 绿。
- 浏览器实测（`pnpm dev`）：写作页 + 人物页 + 大纲页，左栏与中栏交界**只剩一条线**（截图取证）；右栏展开时同理；写作页窄屏（<1024）与收起态不出现第二条线。
- `git log` 有新 commit、`git status` 干净。

### 卡 B：写作页卷章栏 = 中缝圆钮收起/展开

**背景**：三处收起按钮字面同族（`DoubleLeft/RightOutlined`），写作页那个还紧贴左栏那个（相隔 ~16px），语义分不开。参考起点作家助手 = **骑在中缝线中部的圆形单箭头钮**；用户已确认「中缝圆钮 + 常显」。契约已改：`DESIGN.md` §Components `icon-button`（第三族：单箭头圆钮 = 面板内子栏）、`§Layout` 写作页内分栏、`writing-page`（header 不放收起钮 / 宽度与收起 / 图标清单 838 行）。

**改动范围**
1. `packages/client/src/components/writing/chapter-rail.tsx`：header 删掉 `icon-button` 收起钮（只留标题）；`aside` 加 `relative`；`onCollapse !== undefined` 时渲染**骑在右边线中线上的圆钮**：`<Button color="default" variant="outlined" shape="circle" size="small" className="absolute top-1/2 -right-2 z-20 -translate-y-1/2" icon={<LeftOutlined className="text-xs" />} aria-label="收起卷章导航栏" title="收起卷章导航栏" onClick={onCollapse} />`；`-right-2` = 外偏 8px（内探 8px 恰好落在行区 `p-2` 内边距里，不压章名/字数，**不要改行区 padding**）。`DoubleLeftOutlined` import 相应移除（`RightOutlined` 仍被卷行折叠箭头使用，保留）。
2. `packages/client/src/components/ui/collapse-strip.tsx`：加可选 `variant?: "chevron" | "grip"`（默认 `chevron`，现有两处调用不变）；`grip` = 容器 `justify-center` + 中线位置同一枚圆钮（`shape="circle" size="small"` + `RightOutlined`，`aria-label`/`title` 仍用 `label`）。文件头注释补一句两族语义分层。
3. `packages/client/src/pages/Writing.tsx`：写作页的 `<CollapseStrip side="left" variant="grip" ...>`；其余两处（AppShell 左右栏）不动。
4. 测试：`chapter-rail.test.tsx` 补「传 `onCollapse` 时页面含 `ant-btn-circle`，且全页不含 `anticon-double-left`」；`writing.test.tsx` 桌面态补同两条，收起态断言窄条仍是 `ant-btn-circle`（不是 `»`）。已有 `aria-label="收起卷章导航栏"` / `"展开卷章导航栏"` 断言保留。
5. 文档：本次不动 `DESIGN.md`（已在开工前改好，随本卡 commit 一起提交）。

**不做**：不动 AppShell 左右栏收起钮（仍双箭头）；不动 rail 宽度/收起持久化逻辑；不加悬浮/淡入动画。

**验收（硬判据）**
- `pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint` 全绿。
- 浏览器（`pnpm dev`，桌面 1600px）：写作页卷章栏右边线中部有常显圆钮，点它 → 收起为 32px 窄条且窄条中线同款圆钮，点它 → 恢复原宽；左栏「收起左栏」仍是 `«`；鼠标在圆钮上按下**不会**触发宽度拖拽；圆钮不遮挡章行文字/字数。
- `git log` 有新 commit、`git status` 干净。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
