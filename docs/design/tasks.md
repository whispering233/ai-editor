# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

契约来源：`docs/ui/DESIGN.md` §Components `ref-chip` / `skeleton-block`（本轮已写入）。**契约文档不写卡号**，下文的「卡 N」只在清单内有效。

## 并行 / 串行判定

- **三张卡全部串行**（在 main 单写者执行，不开 worktree——本机 worktree 无 `node_modules` / `dist`，`pnpm -r exec` 会拒跑）。
- 依据：`pages/EntityDetail.tsx` 与 `pages/TimelineDetail.tsx` 在**三张卡里都出现**，`design-discipline.test.ts` 在卡 1 / 卡 2 都出现。并行必然冲突，且合并冲突点全在「同类串的第 N 份复制」上，最容易合出错。

---

## 卡 1 · `ref-chip`：可点的内联引用

**目标**：补上第三种 chip（`tag` = 用户数据 / `type-badge` = 枚举结构 / **`ref-chip` = 可点**），把手写 8 处的「描边小按钮」收成一份实现，并让「带未保存守卫的引用跳转」有可表达的形态。

**涉及文件**

- 新增 `packages/client/src/components/ui/ref-chip.tsx`
- 迁移 `8` 处调用点：
  - `pages/EntityDetail.tsx:619`（上级设定 chip，导航）、`:640`（子设定 chip，导航）、`:458` / `:493`（「变更记录 N 条」toggle，动作）
  - `pages/TimelineDetail.tsx:514`（挂载节点 chip，导航 + `truncate`）
  - `pages/HookPanel.tsx:905`（「依赖: …」展开链，动作 + 图标）
  - `components/ui/tags-editor.tsx:124`（追加既有标签，动作）
  - `components/timeline/TimelineEvent.tsx:248`（展开 / 收起，动作 + `text-primary`）
- 守卫 `packages/client/src/design-discipline.test.ts`

**实现骨架**（API 已在设计阶段定稿，不得顺手扩参）

```tsx
// components/ui/ref-chip.tsx
type RefChipTone = "default" | "muted" | "primary";

interface RefChipProps {
  children: ReactNode;
  to?: string;                 // 渲染 <a href={`#${to}`}>，保住中键 / ⌘ 新标签页
  onClick?: (e: MouseEvent) => void; // 无 to 时渲染 <button>；与 to 共存时由调用点 preventDefault + 守卫后再 navigate
  tone?: RefChipTone;          // default = 墨字 / muted = 灰字 hover 转墨 / primary = 主色
  ariaExpanded?: boolean;      // 展开类动作用，缺省不渲染
  className?: string;          // ml-1 / shrink-0 / min-w-0 / truncate / text-left / text-xs 由调用点给
  title?: string;
}
// 固定内部类：inline-flex items-center gap-1 rounded-sm border border-border px-1.5 py-0.5
//             hover:bg-muted focus-visible:outline-1 focus-visible:outline-offset-1 focus-visible:outline-primary
```

**不变式**

- **不设字号**：跟父级走（正文行 14px / 元信息行 12px）。给组件加 `text-xs` 会把 `EntityDetail` / `TimelineDetail` 的引用 chip 从 14px 降到 12px。
- **圆角 = `rounded-sm`（4px）**：DESIGN.md §Shapes 把 4px 定给「小内衬块」；6px 是按钮档。这是**可见像素变化**（7 处 6px → 4px），验收必须看图。
- **不许用 `TypeChip` 加 `onClick` 实现**：`type-badge` 是静态枚举形态，加 hover/焦点会污染「描边 = 类型」的信号。
- **`to` 与 `onClick` 必须可共存**：仓内已有正确写法 `SettingWorkbench.tsx:216`（`<a href>` + `preventDefault` + `confirmDiscard().then(navigate)`）。只允许二选一的 API 会把「带守卫的引用跳转」逼回手写——正是本次要消掉的那种复制。（本卡**不改行为**：`EntityDetail` 的上级 / 子设定 chip 仍裸跳，绕过 `confirmDiscard` 的存量缺陷已单独登记 `backlog.md`。）
- 调用点**不得**自拼 `border border-border px-1.5 py-0.5`（守卫会红）。

**守卫（追加到 `design-discipline.test.ts` 的 `RULES`，与既有 9 条同构：正则 + `allow` 白名单 + 自检样例）**

- 规则 `ref-chip-shell`：家族串 `rounded-(?:sm|md) border border-border px-1\.5 py-0\.5` 只允许出现在 `components/ui/ref-chip.tsx`。**不要写成 `rounded-*`**——那是「`rounded` + 零个或多个连字符」，会漏掉全部 `rounded-md` 站点，却命中 `Dashboard.tsx:834/975` 那两个**不迁移**的静态胶囊（裸 `rounded`）。
- 白名单照抄 `error-banner-shell`（`ERROR_BANNER_ALLOW` + `RULES` 的 `allow`）。`RULES` 现 6 条 + 8 条独立守卫，**不要把条数写进任何契约文档**（数值单源）。
- 同时在「守卫规则自检」块补一条命中样例（命中违规行、放过 `ref-chip.tsx` 自身）——规则不能识别违规就等于没有。

**验收（硬判据，缺一不 PASS）**

- [ ] `pnpm typecheck` / `pnpm lint` 全绿
- [ ] `pnpm -r build`（改过 shared 不需要，但守卫测试读源码，先跑一次确认）
- [ ] `pnpm --filter @whispering233/ai-editor-client test` 全绿（filter 必须逐字等于包名）
- [ ] SSR 断言：`to` 渲染出 `<a href="#/…">`、只给 `onClick` 渲染出 `<button`、`tone` 三档各渲染出对应字色类
- [ ] 浏览器核一次像素（**核前整页重载**）：`#/setting/<id>` 的上级 / 子设定 chip、`#/timeline/<id>` 的挂载节点 chip、`#/hooks` 的「依赖:」chip——看圆角 4px、hover 面、Tab 键焦点环
- [ ] `git status` 干净 + `git log` 含本卡 commit（中文 conventional commit）

**回滚**：单 commit revert（组件与 7 处迁移在同一 commit，避免「组件留着没人用」）。

---

## 卡 2 · `skeleton-block`：卡形加载占位

**目标**：把 4 处同形复制的「描边卡 + N 行灰条」收成一个组件，并把「骨架圆角 = 该页加载后真实卡的圆角」这根耦合写进代码注释。

**涉及文件**

- 新增 `packages/client/src/components/ui/skeleton-block.tsx`
- 迁移 `4` 处：`pages/EntityDetail.tsx:516/521`、`pages/TimelineDetail.tsx:357/362`
- **不收** `character-detail.tsx:924/929`：那里骨架是两列假卡、加载后是 tabs + 单卡（8px），形态本就不一致（已登记 `backlog.md`）
- 守卫 `packages/client/src/design-discipline.test.ts`

**实现骨架**

```tsx
// components/ui/skeleton-block.tsx
interface SkeletonBlockProps {
  rows?: number;      // 缺省 3
  className?: string; // 网格占位等由调用点给
}
// 内部：space-y-3 rounded-md border border-border p-4 + N × <div className={cn(skeletonClass, "h-9")} />
// rounded-md(6px) 必须与它模拟的真实卡同值；那批手写卡迁到 card(8px) 时这里同卡改（见 backlog.md 同名条目）
```

**不变式**

- **只接 `rows` 一个参数**。不加 `rowHeight` / `withTitle`——行内与列表骨架（`h-4`~`h-20`、带宽度、`bg-muted/60` 的那几十处）形状各异，继续直接用 `skeletonClass` 拼。
- 行样式单源仍是 `lib/styles.ts` 的 `skeletonClass`；本组件**不复制** `animate-pulse rounded bg-muted`。
- 圆角**有意保持 6px**（与 `EntityDetail` / `TimelineDetail` 加载后的手写 6px 卡一致，零像素漂移）。**不要顺手改成 8px**——那会让骨架与旁边的 6px 卡错档；改档必须与那 4 处手写卡迁 `SectionCard` 同卡做。

**守卫**

- 规则 `skeleton-block-shell`：家族串 `space-y-3 rounded-md border border-border p-4` 只允许出现在 `components/ui/skeleton-block.tsx`。
- 同样补自检样例。

**验收**

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿
- [ ] SSR 断言：`rows` 缺省 3 行、`rows={5}` 5 行、每行都带 `skeletonClass` 的类
- [ ] 像素：`#/setting/<id>`、`#/timeline/<id>` 各看一次骨架**与加载完成后卡边缘是否对齐**（整页重载后立即截图，或限速网络）
- [ ] `git status` 干净 + `git log` 含本卡 commit

**回滚**：单 commit revert。

---

## 卡 3 · 5 处「假按钮」改回 `Button href`

**目标**：修掉 5 处 `<a className="rounded-md border border-border px-4 py-1.5 …">`——它们与旁边真正的 antd `Button` 并列，高度 / hover / 焦点环 / 禁用态全不同，而 `DESIGN.md` 早已规定导航型操作用 `Button href`（仓内已有 10+ 处正确写法）。

**涉及文件**

- `components/blocknote/manuscript-states.tsx:17`
- `components/character/character-detail.tsx:907`
- `pages/EntityDetail.tsx:395`
- `pages/TimelineDetail.tsx:304`
- `pages/Outline.tsx:373`（带 `whitespace-nowrap`）

**改动范围**：只把「去回收站」那个 `<a>` 换成 `<Button href="#/trash">去回收站</Button>`。**不动**旁边的「返回列表」按钮，不动文案，不动空态布局。

**不变式**

- 不借机改空态文案 / 按钮顺序。
- 不顺手把 6 处墨色链接（`text-primary hover:underline`）一起改——那需要先在 `index.css` 补 `--color-link`，已单独登记 backlog。

**验收**

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿
- [ ] 像素：5 个空态页各看一次「去回收站 + 返回列表」两个按钮是否**同高、同 hover 面、同焦点环**（整页重载）
- [ ] `git status` 干净 + `git log` 含本卡 commit

**回滚**：单 commit revert。
