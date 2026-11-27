# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史见 `CHANGELOG.md`）；未排期项进 `backlog.md`；执行纪律见 `AGENTS.md`「协作流程」。

契约来源：`DESIGN.md` §Components `card` / `section-title` / `skeleton-block`（既有登记）。**契约文档不写卡号**。

## 并行 / 串行判定

- **两张卡可以并行**（文件不重叠：卡 A 只碰 `index.css` / `DESIGN.md` / 6 个链接站点；卡 B 只碰 `EntityDetail` / `TimelineDetail` 的卡片块 + `skeleton-block`）。
- 但按本机纪律（worktree 无 `node_modules` / `dist`，`pnpm -r exec` 拒跑）**仍在 main 串行执行**，一卡一 commit。若卡 A 定色为「蓝」，它会同时改 `character-detail.tsx` / `Dashboard.tsx`，与卡 B 无交集，顺序无关。

---

## 卡 A · 「行内链接」口径登记（文档 + 6 处对齐）

**目标**：`DESIGN.md` 只登记了 `Link (#0075de)`「**正文**链接专用」，而 UI 里 6 处**行内可点文本**（不是正文、也不是按钮）没有口径，各写各的。本卡把这条口径补上，让 6 处与文档一致。

**现状（已核实）**

| 站点 | 语义 | 当前写法 |
| :--- | :--- | :--- |
| `character-detail.tsx:558` / `:567` / `:704` | 说明句里的逃生链接（「未设置阅读进度……去大纲设进度」） | `text-primary hover:underline` |
| `pages/Dashboard.tsx:1143` | 概览页「阅读进度」的**值**（跳到该章） | `text-primary hover:underline` |
| `pages/ReferenceDetail.tsx:504` | 参考资料「来源」的**外部 URL** | `inline-flex items-center gap-1 text-primary hover:underline` + `ExportOutlined` |
| `pages/ReferenceList.tsx:497` | 列表行里的外部 URL | `inline-flex max-w-full items-center gap-1 text-xs text-primary hover:underline` + `truncate` |

**关键事实**

- `text-primary` = `--primary` = `--ant-color-primary` = **深墨 `#37352f`**（浅色）；`AntdProvider` 另配了 `colorLink` = `#0075de`（深色 `#529cca`），但**全站没有一处用到它**（`Button href` 走按钮表皮，`Typography.Link` 无消费点）。
- `index.css` 的 `@theme inline` **没有 `--color-link`** ⇒ 现在写不出 `text-link` 这个类。
- 6 处都是 2~3 个 token 的短类串；按 `lib/styles.ts` 的既有规则（≥3 处 **且** 稳定纯样式才提取、短类不提取），**不建组件**，只登记口径 + 对齐 class。

**两种改法（取决于定色，见本卡末尾）**

- **墨（保持现状色）**：`DESIGN.md` §Colors 把 `Link` 口径收窄为「**正文 / 富文本**内链接（由块编辑器渲染）」，并在 §Components 新增 **`inline-link`** 条目 = *UI 内行内可点文本*：`{colors.primary}` 墨字 + `hover:underline`，**不新增色值、不建组件**；6 处不动色，只把 `text-xs` 那处的语境写进条目（紧凑列表行可用 12px）。
- **蓝（严格执行「链接是蓝的」）**：`index.css` 的 `@theme inline` 补 `--color-link: var(--ant-color-link)`，6 处改 `text-link`；`DESIGN.md` 把 `Link` 的适用范围从「正文」扩到「所有行内链接」；`dead-token` 守卫会自动验证新变量有消费者。

**验收（两种改法共用）**

- [ ] `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 全绿
- [ ] 若改蓝：浏览器量 `#/overview`（阅读进度值）与 `#/reference/<id>`（来源 URL）的 computed `color`，浅 / 深两态各一次（**核前整页重载**）
- [ ] 若保持墨：`DESIGN.md` 的两处口径（`Link` 收窄 + `inline-link` 新增）互相不矛盾，且 `colorLink` 在文里仍登记（它是 antd token，未来 antd 组件会用到）
- [ ] `git status` 干净 + `git log` 含本卡 commit

---

## 卡 B · 4 处手写分区卡 → `SectionCard`（骨架同卡改 8px）

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
