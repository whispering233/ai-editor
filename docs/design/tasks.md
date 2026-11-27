# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

## 批次：UI/UX 治理 P0（2026-11-27）

**批次口径**：四项全部是「实现 `DESIGN.md` 已写的东西」——不改产品语义、不新增能力、不做产品决策。一卡一 commit，**串行在 main 执行**（本机 `git worktree` 跑不了验证，见 `AGENTS.md`「测试与验证」）。

**批次级硬约束**：

- **改动面是增量，禁止用 `git checkout -- <file>` / `git restore <file>` 归零文件**。`HookPanel.tsx` / `Timeline.tsx` 被卡 1/3/4 都碰，`chapter-editor.tsx` 被卡 3/4 碰——前面卡的改动必须留在工作区里带着走。
- **通用的硬完成判据**（每卡都要满足，缺一不算完成）：
  1. `git log --oneline -1` 显示该卡的新 commit（中文 conventional commits），`git status --short` 为空。
  2. `pnpm -r build` 后 `pnpm typecheck` / `pnpm lint` / `pnpm -r test` 全绿；**本机既有红**（`backlog.md`「开发环境」：`EPERM` / `0600` / 本地 WebDAV 403 / 端口占用）必须逐条点名，不得当基线。
  3. 汇报附：commit hash + 关键命令原始输出片段 + 未做 / 未验证项。
- **`designmd lint docs/ui/DESIGN.md` 本机不可用**（CLI 未安装，`npx @google/design.md` 连 `--version` 都空输出）⇒ 每卡汇报里写「DESIGN lint 未执行」，别假装跑过。
- **本仓无 jsdom**：client 测试只有 `renderToString`（SSR），且 `@rc-component/portal` 在无 DOM 环境**恒返回 `null`**（`Portal.js` 的 `!canUseDom() → return null`）⇒ **任何弹窗的可见性 / 焦点 / 叠层行为都不能用 SSR 断言**，只能浏览器实测。卡 4 按这条设计判据。

---

### 卡 1｜骨架占位收敛到 `skeletonClass`

**目标**：`lib/styles.ts` 的「重复 ≥3 处即提取」规则事实上没执行——`skeletonClass` 已在 13 个 tsx 消费，但另有 **4 个文件 14 处**手写了同一串。

**改动面**（只有这 4 个文件）：

- `pages/HookPanel.tsx`（4 处，`~496-504`）
- `pages/Timeline.tsx`（4 处，`~578-581`）
- `pages/TimelineDetail.tsx`（3 处，`~357`、`~362`、`~416`）
- `components/delta/compute-preview.tsx`（3 处，`~147-149`；`~149` 是 `bg-muted/60`，**必须** `cn(skeletonClass, "… bg-muted/60")` 保留覆写）

**做法**：`<div className="h-4 w-1/2 animate-pulse rounded bg-muted" />` → `<div className={cn(skeletonClass, "h-4 w-1/2")} />`。跟着各文件既有 import 风格（`@/lib/…` 或 `../../lib/…`），不要统一改写整个 import 块。

**判据**：

- `grep -rn 'animate-pulse rounded bg-muted' packages/client/src --include=*.tsx` **零命中**（`lib/styles.ts` 的定义在 `.ts` 里，不在此列）。
- 不新增任何测试（纯类串等价替换）。

**验证**：纯类串替换 ⇒ **不得有任何像素变化**；全量测试即可，不用浏览器。

**风险**：`compute-preview.tsx:149` 若忘了 `cn` 直接拼字符串，静态 `bg-muted` 会盖掉 `bg-muted/60`（只有 `twMerge` 才按后者胜）。

---

### 卡 2｜删除 12 个死 token + 加 dead-token 守卫

**目标**：`index.css` 里 shadcn 模板残留的变量零消费者；并用一条断言把「新组件照抄 shadcn 变量块」这条路封住。

**改动面 1：删 `packages/client/src/index.css` 共 22 行**

- `:31-38` `--color-sidebar-ring/border/accent-foreground/accent/primary-foreground/primary/foreground/sidebar`（8 行）
- `:47-48` `--color-secondary-foreground` / `--color-secondary`
- `:53` `--color-card-foreground`
- `:134` `--card-foreground`
- `:139-140` `--secondary` / `--secondary-foreground`
- `:149-156` `:root` 的 8 条 `--sidebar-*`

删前用 `var(--sidebar` / `var(--secondary` / `var(--card-foreground` **精确复检一次**（`sidebarCollapsed` / `layouts.sidebarWidth` 是同名前缀的无关标识符，不是消费者）。

**改动面 2：`design-discipline.test.ts` 加 1 个 `it()`**

判定口径写死成下面这一条（不要自己发明）：

> 对 `index.css` 里**每一个**声明的变量 `--x`，必须至少有一处**来自 `index.css` 之外**的可达消费：
> - **(a)** `src/**/*.{ts,tsx,css}`（排除 `index.css` 自身）里出现 `var(--x)`；或
> - **(b)** 存在映射 `--color-<k>: var(--x)` **且** 代码里出现工具类 `*-<k>`；或
> - **(c)** `x` 本身形如 `color-<k>` 且代码里出现工具类 `*-<k>`。

三个易错点，逐条写进测试注释：

1. **工具类前缀表必须含 `rounded` 与 `font`**，否则 `--radius-sm/md/lg`（`rounded-sm` 在用）与 `--font-sans`（`index.css` 的 `@apply font-sans`）会被误杀。
2. **消费者扫描必须包含 `*.css`**：真消费者在 `components/outline-canvas/canvas-theme.css`（`var(--background)` / `var(--border)` / `var(--card)` / `var(--input)` / `var(--muted-foreground)`）与 `components/blocknote/blocknote.css`（`var(--font-sans)`）。**不能直接用 `sourceFiles()`**——它只收 `.ts/.tsx`。
3. **必须排除 `index.css` 自身的 `var()` 命中**，否则 `@theme inline` 的成对映射（`--color-tag-sky: var(--tag-sky)`）会让每条变量自匹配 ⇒ 对要防的场景**恒绿**。成对形态靠 (b) 判「映射是否通往真实工具类」。
4. `--paper-cream` / `--paper-warm` **不需要白名单**：它们在 `hooks/use-writing-prefs.ts:72-73` 是字面量 `"var(--paper-cream)"`，走 (a) 即可命中。
5. 卡 4 会新增 `--modal-mask` / `--float-shadow` 两个变量，并在 `dialog.tsx` 里以字面量 `"var(--modal-mask)"` 消费 ⇒ 本守卫对它们应保持绿。**若卡 4 落地时这里报红，是卡 4 写错了（写成了 `rgba(...)` 字面量），不要放宽守卫。**

**改动面 3：规则自检** —— 按该文件既有 `describe("守卫规则自检")` 的写法补一条：喂一个「只声明、无消费」的样例必须被识别；喂 `rounded-sm` / `font-sans` / `--paper-cream` 三条必须被放过。

**判据**：

- 声明行口径（不含注释里的变量名——`index.css` 里留了一条注释点名这三组变量、说明为什么删）：`grep -cE '^\s*--(sidebar|secondary|card-foreground)' packages/client/src/index.css` = 0。
- 构建产物 CSS 里 `--sidebar` / `--secondary` / `--card-foreground` **零命中**（`pnpm --filter @whispering233/ai-editor-client build` 后 grep `dist/assets/*.css`；**比内容不比文件名**——产物文件名带 hash）。实测两个构建对比：122,453 B → 121,963 B（**-490 B**）。
- 新断言在「手工加回一个 `--foo: var(--bar)` 且无消费」时**会红**（提交前验一次再删掉）。

---

### 卡 3｜`ErrorBanner` 收口错误条

**目标**：同一件「错误说明 + 重试 / 动作」的事被手写 18 处（14 个文件）；收敛成一个组件，并删除 `lib/styles.ts` 的 `errorBannerClass`。

**改动面 1：新增 `packages/client/src/components/ui/error-banner.tsx`**

- props：`message: ReactNode`、`onRetry?: () => void`、`retryLabel?: string`（缺省「重试」）、`actions?: ReactNode`、`layout?: "row" | "stack"`（缺省 `row`）、`className?: string`（**只承载外边距**）。
- 壳类串沿用现 `errorBannerClass`（`rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive`）**移进组件内部，不再导出**。
- `row`：`flex items-center gap-3` + 消息 `min-w-0 flex-1` + 按钮 `size="small"`；`stack`：说明 + 垂直 `block` 按钮。
- 按钮一律 antd `Button`（不自绘）。

**改动面 2：迁移 14 个文件 18 处**

`errorBannerClass` 的 12 文件 **16 处**：`character-rail.tsx:90`、`setting-rail.tsx:980`、`chapter-editor.tsx:576`、`chapter-rail.tsx:125`、`FreeDetail.tsx:178`、`HookPanel.tsx:481`、`Outline.tsx:321` + `:1526`、`OutlineCanvas.tsx:382` + `:546`、`PracticeDetail.tsx:226`、`ReferenceDetail.tsx:383` + `:522`、`Timeline.tsx:560`、`Writing.tsx:251` + `:305`。

外加两处**不引常量、但语义就是错误条**的同串手写：

- `components/character/character-detail.tsx:577`（纯文案，无按钮 → `row`，无 `onRetry`）
- `pages/Trash.tsx:355`（409 祖先冲突：文案 + 「还原上级」按钮 → `actions`）

「返回列表」/「返回章节目录」/「还原上级」走 `actions`；`mb-3` / `mt-2` / `m-3` / `shrink-0` 等外边距移到调用点 `className`。

**改动面 3：删 `lib/styles.ts` 的 `errorBannerClass`**（保留 `skeletonClass`），同步 `AGENTS.md`「前端」段加一条：**错误条单源 = `components/ui/error-banner.tsx`**（外边距由调用点传；不得复活第二份手写）。

**改动面 4：新增 `error-banner.test.tsx`（SSR，antd `Button` 在 SSR 下正常渲染）**

① 有 `onRetry` → 按钮渲染、且在消息之后；② 无 `onRetry` → 不渲染按钮；③ `actions` 插槽渲染；④ `layout="stack"` 的按钮带 `block` 类。

**判据**：

- `grep -rn 'errorBannerClass' packages/client/src` 零命中。
- `grep -rn 'border-destructive/30 bg-destructive/10' packages/client/src` **只允许** `components/ui/error-banner.tsx`。**明确豁免的三处**（形态与语义都不同，在 `DESIGN.md` 已点名排除）：`feedback/ErrorBoundary.tsx`（整页崩溃兜底）、`feedback/FeedbackHost.tsx`（全局 `fixed` 错误横幅）、`delta/compute-preview.tsx`（带图标与条目列表的「状态冲突」警示块）。
- 4 条 SSR 断言全绿。
- **浏览器像素核对**（必做，测试替代不了）：① 一个内联态（写作页保存失败或 rail 刷新失败）；② 一个 `stack` 态（人物 rail 整栏错误 / 参考资料整页错误）；③ 全局确认框里的错误行（`ConfirmDialog` 的 onConfirm 失败态）未被波及。

**风险**：本卡是本批**唯一会改像素**的卡——`gap-2 → gap-3` 只影响 4 处（`setting-rail.tsx:980`、`HookPanel.tsx:481`、`Timeline.tsx:560`、`Trash.tsx:355`），其余原本就是 `gap-3`。若某处观感变差，允许用调用点 `className` 覆写 `gap`，**不得**为此恢复第二份手写实现。

---

### 卡 4｜`Dialog` 换芯 antd `Modal`（换芯不换皮）

**目标**：自绘 `Dialog` 无焦点陷阱 / 无关闭归还 / 无初始聚焦，且 `dialog` / `popover` / `context-menu` 三处各挂一个 `window` `keydown` ⇒ 叠层按一次 `Esc` 全关。换芯 antd `Modal`（rc-dialog 的 portal 栈天生「只关最顶层」），表皮与 API 保留。

**改动面 1：`components/ui/dialog.tsx` 重写内部壳**

`DialogContent` → antd `Modal`，参数：`open` / `onCancel={ctx.close}` / `footer={null}` / `closable={false}`（关闭钮继续自绘，`showCloseButton` 保留）/ `centered` / `destroyOnHidden` / `keyboard` / `mask={{ closable: true }}`（v6 已弃用 `maskClosable`）/ `focusable={{ trap: true, focusTriggerAfterClose: true }}`。

**几何与内容层的四个钉子（少一个就静默错位）**：

1. `styles.container = { padding: 16, borderRadius: 8, border: "1px solid var(--ant-color-border-secondary)", boxShadow: "var(--float-shadow)" }` —— `DialogFooter` 的 `-mx-4 -mb-4` 依赖这个 16（antd 默认 `contentPadding` = 20/24、`bodyPadding` = 0）。
2. `styles.body = { display: "grid", gap: 16, maxHeight: "calc(100vh - 4rem)", overflowY: "auto", padding: 0 }` —— **原 `DialogContent` 那串 `grid gap-4` 是所有弹窗的槽间距来源**（全局确认框的三段全靠它），antd 的 body 没有 gap，不搬过去标题与说明会贴死。
3. `styles.mask = { backgroundColor: "var(--modal-mask)", backdropFilter: "blur(2px)" }`（不是 antd 默认的 45% 黑）。
4. **色值必须进 `.css`**：`design-discipline.test.ts` 的 `hardcoded-color` 守卫只放行 `components/AntdProvider.tsx` ⇒ 在 `dialog.tsx` 里写 `rgba(...)` **必红**。在 `index.css` 的 `:root` 加两个变量（与 `--tag-*` / `--heat-*` 同口径）：
   ```css
   --modal-mask: rgb(0 0 0 / 0.10);
   --float-shadow: 0 8px 24px rgb(15 15 15 / 0.10);
   ```
   并在 `DESIGN.md` 的 §Elevation 与 `dialog` 条目里已有引用（已写「走 CSS 变量」），实现照文档做即可。

删除：`DialogOverlay` / `DialogPortal` / `DialogTrigger` / `DialogClose` 四个**导出**（零外部使用者），以及自绘的 `document.body.style.overflow` 滚动锁（交回 antd `scrollLock`）。**注意**：Content 内部仍在用 Overlay / Close 的等价物——改动是「不外露」，不是「删掉内部关闭钮」。

**改动面 2：宽度改走档位 prop，23 处调用点各改一行**

`export const DIALOG_WIDTHS = { sm: 384, md: 448, lg: 512, xl: 576, "2xl": 672 } as const;`，`DialogContent` 收 `width?: keyof typeof DIALOG_WIDTHS`（缺省 `md`）。替换 `className="sm:max-w-*"` → `width="*"`：

`command-help.tsx:153`(xl)、`create-character-dialog.tsx:77`(2xl)、`create-relation-dialog.tsx:231`(2xl)、`edit-relation-dialog.tsx:70`(lg)、`chapter-editor.tsx:648`(md)、`outline/dialogs.tsx:66`(md)、`create-piece-dialog.tsx:153`(lg)、`create-sample-dialog.tsx:262`(lg)、`cloud-conflict-dialog.tsx:68`(lg)、`cloud-stale-backup-dialog.tsx:45`(md)、`llm-section.tsx:282`(md)、`models-providers-panel.tsx:198`(2xl)、`book-delete-dialog.tsx:130`(md)、`cloud-remote-books-dialog.tsx:224`(lg)、`export-book-dialog.tsx:190`(md)、`Dashboard.tsx:1000`(sm)、`HookPanel.tsx:592/643/659/732`(md/lg/md/md)、`StyleNotes.tsx:350`(sm)、`Timeline.tsx:648/688`(md/md)。

（`dialog.test.tsx:11` 的 `<DialogContent>` 无 className，不涉及。）

**改动面 3：`dialog.test.tsx` 重写**

**不要断言 SSR 里能看到弹窗内容**——`@rc-component/portal` 在无 DOM 环境恒 `return null`，`open=true` / `open=false` 的 `renderToString` 都是 `""`，原用例会变成恒真空跑。改成断言**可测的纯契约**：`DIALOG_WIDTHS` 的档位映射（5 个键 → 5 个值）+ 缺省档为 `md`；并在文件头注释写清「可见性 / 焦点 / 叠层只能浏览器核对，原因是 Portal 在 SSR 恒空」，免得下一个人重新踩。

**改动面 4：`AGENTS.md`「前端」段加一条**

`Dialog` 换芯口径（焦点/归还/Esc 由 antd 提供，不要再挂 `window keydown`；**弹窗宽度只能用 `width` prop**，`max-w-*` 会被 antd 无层 CSS 压掉）。同步 `DESIGN.md` 已写的 `dialog` 条目（文档先于代码，**不要改文档**）。

**判据**：

- `grep -rn 'sm:max-w-' packages/client/src` **零命中**；`grep -rn 'DialogOverlay\|DialogPortal\|DialogTrigger\|DialogClose' packages/client/src` 零命中（文档除外）。
- `DIALOG_WIDTHS` 的映射断言全绿。
- **浏览器实测四条（本卡唯一有效的验证方式）**：
  1. 打开「彻底删除」确认框 → `Tab` 环绕框内、不跑到背后页面；
  2. 关闭后焦点回到触发按钮；
  3. 画布连线抽屉（`PlotEdgeDrawer`，antd `Drawer`，`zIndex: 40`）+ 删除确认框叠层 → 按一次 `Esc` **只关最上层**，且确认框压在抽屉之上；
  4. 遮罩色 / 模糊 / 1px 描边 / 阴影与换芯前一致（对比浅遮罩，不是 45% 黑）。
- **另核两处像素**：全局确认框三段间距 16px 不塌（`grid gap-4` 搬家成功）；高弹窗（`command-help` 或 `create-character-dialog`）内容与页脚不错位（`padding: 16` + `-mx-4 -mb-4` 对齐成功）。

**已知取舍（写进汇报，不要当成缺陷修）**：

- 「`Esc` 只关最顶层」**只对 antd portal 栈内的浮层成立**；`popover` / 右键菜单仍是各自 `window` 监听（本卡按 Q3 选 A，不动），所以「弹窗 + Popover 同开 → 一次 `Esc` 关两个」的残留仍在。**验收 ③ 的复现路径不得同时开 Popover / 右键菜单**，否则结论不可信。
- `sm:max-w-*` 原来是「<640px 视口不设上限」，换 `width` 后变成恒定值 + antd 的 `max-width: calc(100vw - 32px)` ⇒ 窗口缩到 400~640px 时宽度会略有变化（可接受）。
- `DialogFooter` 的 `rounded-b-xl`(12px) 与容器 8px 圆角不一致是**既有现状**，不在本卡修。
