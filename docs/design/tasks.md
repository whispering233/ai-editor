# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

契约来源：`docs/ui/DESIGN.md` §Components `ref-chip` / `skeleton-block`（本轮已写入）。**契约文档不写卡号**，下文的「卡 N」只在清单内有效。

## 并行 / 串行判定

- **剩余两张卡串行**（在 main 单写者执行，不开 worktree——本机 worktree 无 `node_modules` / `dist`，`pnpm -r exec` 会拒跑）。
- 依据：`pages/EntityDetail.tsx` 与 `pages/TimelineDetail.tsx` 在**两张卡里都出现**，`design-discipline.test.ts` 也都出现。并行必然冲突，且冲突点全在「同类串的第 N 份复制」上，最容易合出错。

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
