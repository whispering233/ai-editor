# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

契约来源：`DESIGN.md` §Components `card` / `section-title` / `skeleton-block`（既有登记）。**契约文档不写卡号**。

## 并行 / 串行判定

- **只剩一张卡**（`EntityDetail` / `TimelineDetail` 的卡片块 + `skeleton-block` + 守卫正则）。
- 本机 worktree 无 `node_modules` / `dist`（`pnpm -r exec` 拒跑）⇒ 在 main 单写者执行，一卡一 commit。

---

## 卡 · 4 处手写分区卡 → `SectionCard`（骨架同卡改 8px）

**目标**：`EntityDetail` / `TimelineDetail` 各 2 处自己写的「描边卡 + `<h2 class="text-sm font-semibold">`」改回 `SectionCard`（antd Card），让圆角与块标题回到 `DESIGN.md` 契约；**同时**把 `SkeletonBlock` 的圆角与它一起改到 8px（否则加载完成瞬间跳档）。

**现状（已核实）**

| 站点 | 形状 |
| :--- | :--- |
| `pages/EntityDetail.tsx:530`（基础信息） | `<h2 class="mb-3 text-sm font-semibold">` + `<div class="flex flex-col gap-3">` |
| `pages/EntityDetail.tsx:560`（关联） | `<div class="mb-3 flex items-center justify-between">` + `<h2 class="text-sm font-semibold">` + `<Button>+ 新增关联</Button>` |
| `pages/TimelineDetail.tsx:374`（基础信息） | 同第一行 |
| `pages/TimelineDetail.tsx:443`（关联节点） | 同第二行，动作是 `Popover`（挂载选择器）而非 `Button` |

契约偏差：圆角 **6px vs `card` 8px**；块标题 **14px/600 vs `section-title` 16px/600**。内边距两边都是 16px（`Card.bodyPadding` 已在 `AntdProvider` 钉成 16，见其注释），**所以只变圆角与标题字号**。

**改动范围**

- 4 处换成 `<SectionCard title="…" action={…}>`；`action` 直接吃现有的 Button / Popover（`SectionCard` 的 `action` 是 `ReactNode`）
- `components/ui/skeleton-block.tsx`：`SHELL_CLASS` 的 `rounded-md` → `rounded-lg`，并把头注释里的耦合说明改成「= `card` 的 8px」
- `components/ui/skeleton-block.test.tsx`：断言翻转（`toContain("rounded-lg")` + `not.toContain("rounded-md")`），「逐字比对」那条字符串同步
- `design-discipline.test.ts`：`skeleton-block-shell` 的正则改成**与圆角无关**（`space-y-3 rounded-(?:md|lg) border border-border p-4`）——否则改到 8px 后新抄的 8px 骨架不会被拦
- `DESIGN.md` 的 `skeleton-block` 条目：圆角口径从「手写 6px」改为「= `card` 8px」
- `backlog.md`：清掉「4 处手写分区卡应改回 SectionCard」这一条（本卡兑现）

**不变式**

- **不动**两页的「加载失败」提示盒（`EntityDetail:517` / `TimelineDetail:361`：`p-4 text-sm text-muted-foreground`）——它不是分区卡，属另一族（已登记 backlog）。
- 不动「基础信息」块内的表单结构（`flex flex-col gap-3` 原样保留，`SectionCard` 的标题行替换掉原来的 `<h2>`）。
- 不顺手改 `character-detail.tsx` 那 2 处 6px 骨架（它是另一种形态，仍留在 backlog）。

**验收（硬判据）**

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿
- [ ] 浏览器量 4 块：computed `border-top-left-radius` = **8px**、块标题 `font-size` = **16px**（`#/setting/<id>`、`#/timeline/<id>`，**核前整页重载**）
- [ ] 浏览器量骨架（首帧探针 `requestAnimationFrame`）：`#/setting/<id>` 加载态两块 = **8px**，与加载完成后的卡**同值**
- [ ] 深色态各看一次（圆角与字号不随主题变，但要确认没把 Card 的描边/底色带歪）
- [ ] `git status` 干净 + `git log` 含本卡 commit

**回滚**：单 commit revert（4 处卡 + 骨架圆角 + 守卫正则 + 测试必须在同一 commit，否则中间态是「骨架 6px vs 卡 8px」的跳档状态）。
