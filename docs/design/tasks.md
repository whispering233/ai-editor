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

### 卡 B：写作页卷章栏 = 中缝圆钮收起/展开（待卡 A 合入后开始）

**背景**：三处收起按钮字面同族（`DoubleLeft/RightOutlined`），写作页那个还紧贴左栏那个，语义分不开；参考起点作家助手 = **贴在中缝线中部的圆形单箭头钮**。用户已确认「A. 中缝圆钮 + 常显」。契约待本卡同步进 `DESIGN.md`（`icon-button` 家族第三族 + `writing-page` header 收起按钮删除）。

**改动范围**：`chapter-rail.tsx`（删 header 双箭头按钮，改右侧边线中线 24px 圆钮 `LeftOutlined`，`absolute -right-3 top-1/2 -translate-y-1/2 z-20`，`pointerdown` 不冒到拖拽手柄）；`components/ui/collapse-strip.tsx`（加变体：圆钮形态，中线位置 `RightOutlined`）；`pages/Writing.tsx` 传变体；测试与 `DESIGN.md:538`/`:837`/`writing-page` 同步。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
