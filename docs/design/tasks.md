# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）、`docs/ui/DESIGN.md`（**视觉契约**：颜色/字号/圆角/组件外观 + antd token 覆盖表）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）；**视觉改动改完必跑** `packages/client` 的 `design-discipline.test.ts`（源码扫描硬约束）与 `designmd lint docs/ui/DESIGN.md`。
- **视觉改动顺序**：先改 `docs/ui/DESIGN.md`（契约）→ 再改 `AntdProvider.tsx`（token）→ 最后改调用点；反了必然产生「文档与实现两套事实」。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-11，v0.0.28 已打 tag）

v0.0.1-v0.0.27 发布链路全绿；**v0.0.28 = 批次十九：视觉语言统一（Notion 工作区暖灰 × antd 单一组件语言）**——11 卡 11 commit，每卡「实现 + oracle 独立核验 + 五道门禁（`designmd lint` / `pnpm typecheck` / `pnpm lint` / client test / client build）」：

| 卡 | 内容 |
|---|---|
| T1 | 主题 token：antd 默认蓝 → Notion 暖灰 seed（浅/深**两套**，因 `theme.token` 显式值在算法派生后覆盖）+ 组件 token 覆盖 + `controlOutlineWidth: 0`（聚焦 = 1px 描边、无环） |
| T2 | 页头统一：`PageTitle` 薄壳（`Typography.Title level={4}` = 20px/600）；`Typography.titleMarginBottom: 0` 接管标题下边距 |
| T3 | 字号四档（20/16/14/12）+ 清 74 处 `!` 前缀类 + 手写 10/11px 字号归零 |
| T4 | 卡片/空态：`SectionCard`→`Card`、`EmptyState`→`Empty`（对外 props 不变、调用点零改动）；preset 色 Tag 与越档半径清零 |
| T5 | 按钮：19 文件 → antd `Button`，删 `ui/button.tsx`；NavRail 选中态 `variant="filled"`（= `colorFillTertiary` = `surface-muted`） |
| T6 | 输入框：`ui/input.tsx` + `inputClass` → antd `Input`/`TextArea`；`autoComplete` 上收 `ConfigProvider` |
| T7 | 图标：`@ant-design/icons` 单点化（lucide 退役）；尺寸随 `text-*`；状态 Filled / 操作与导航 Outlined |
| T8 | 反馈：sonner → antd `message`（`<App component={false}>` 上下文）；删 `sonner`/`lucide-react` 依赖 |
| T9 | 纪律守卫 `design-discipline.test.ts`（5 规则 + 规则自检）——当场扫出并修 6 处被 **antd 无层 CSS** 静默压掉的类 |
| T6b | 22 处原生 `<select>` → antd `Select`（`optgroup` → 分组 `options`，组级禁用下推到每个 option） |
| T10 | 收尾：删死代码 `book-cover`、零消费者依赖（`class-variance-authority`/`react-markdown`）、圆角遗留变量、过期测试名；DESIGN.md 对齐 |

**无待做项**；迭代路线见 `milestone.md`；运行/构建/发布手册见 `build.md`；版本史见 `CHANGELOG.md`（逐卡执行明细与 commit 从 `git log` 回溯）。

## 当前任务卡（批次二十：用户反馈九项 + 语义色 P0 事故）

**背景**：用户报 9 项（颜色单调 / 图标按钮颜色不一 / 标签不突出 / 时间轴按钮不对齐 / 搜索框位置与样式不一 / 标题有无不一 / 控件行结构不一 / 拖拽无插入线 / 用户气泡看不清）。排查时发现一条 **P0 系统事故**：`index.css` 的语义色映射整体失效（antd cssVar 不注入 `:root`），它是「颜色单调 / 图标颜色不一 / 标签不突出 / 无插入线」的共同根因。

**卡序与依赖**：T1 → T2（可并行，单文件）→ T3 → T4 → T5 → T6 → T7 → T8。T3/T4/T5/T6/T7 共触 `setting-tree` / `Timeline*` / `EntityList` / `HookPanel` 等文件，**必须串行**。

- [x] **T1 [P0 BUG] 语义色作用域修复**：`AntdProvider` 固定 `cssVar.key = CSS_VAR_KEY`（导出常量）+ `index.html` 的 `<html class>` 同值；`design-discipline.test.ts` 新增守卫（读 index.html 断言字面量一致）；文档已在 DESIGN.md §Colors 记录坑与约定。验收：headless 实测 `--ant-color-primary` 在 `:root` 有值、`bg-primary`/`bg-card`/`border-border`/`text-muted-foreground` 均解析出真色。
- [x] **T2 [P0 BUG] 右栏用户气泡对比度**：`ChatPanel.tsx` 的 user 气泡底色 `token.colorPrimaryBg`（实测 `#787771`）→ `token.colorFillTertiary`（= `surface-muted`，DESIGN.md 契约）；补一条断言/注释防回退。
- [x] **T3 [BUG] 时间轴行按钮对齐**：`TimelineGroup` 组标题内容列补 `px-3`，使组标题行与事件卡右缘（含删除按钮列）垂直对齐。
- [x] **T4 [BUG] 拖拽与临时高亮反馈可见**：抽 `components/ui/drop-indicator.tsx`（primary 3px 实线 + 端点圆点）替换三处（Outline `bg-accent` 死线 / setting-tree 自绘 / Timeline 2px 线）；「成为子级」目标行与「新建即聚焦/定位」临时高亮从 `bg-accent/40`（近白）改 `bg-primary/10 + ring-primary/30`（Outline / setting-tree / EntityList / TimelineGroup 四处）。
- [x] **T5 [需求] tint 标签系统**：`index.css` 定义 `--tag-*` 6 色（浅实色 + 深 20% 叠色）+ `@theme inline` 暴露 `bg-tag-*`；新增 `lib/tag-tint.ts`（FNV-1a hash → tint，纯函数）+ `components/ui/tag-chip.tsx`；替换 9 处标签/类型徽标（EntityList×2 / ReferenceList / relations-view×3 / Trash / Outline / OutlineDetail / setting-tree / TimelineEvent / HookPanel）；`lib/tag-tint.test.ts` 锁稳定性与穷尽。
- [x] **T6 [UX] 图标按钮统一**：自绘 `<button>` 图标按钮（setting-tree 折叠箭头/↑↓/删除、AppShell 拖拽柄）→ antd `Button variant="text" size="small"`；不可恢复操作统一 `danger`；清 `lib/styles.ts` 的死常量（连同唯一消费者 AppShell）。
- [x] **T7 [UX] 页面头部统一**：人物/设定/地点/关联四页补 `PageTitle`（标题行独立）；第二行控件行按「左：搜索→分类→标签→排序；右：操作按钮」重排（EntityList 家族 / setting-tree 工具栏 / relations-view / ReferenceList / HookPanel / Outline / Timeline）；搜索框统一 `search-input` 规格（`SearchOutlined` + `w-48` + `allowClear`，设定树补图标）；概览/回收站/详情页不动。
- [ ] **T8 [验证] 批次验收**：oracle 独立核验全部改动（对照 DESIGN.md/layout.md 契约逐条）；五道门禁（`designmd lint` / `pnpm typecheck` / `pnpm lint` / `pnpm -r test` / `pnpm -r build`）+ headless 像素核验（浅/深/拖拽三态）。

### 当前任务卡（批次二十一：链式新建断链）

**背景**（用户反馈）：设定页「新建→回车确定→再回车新建子设定」做不到——实测根因：就地新建提交后，新条目只拿到**键盘焦点 + 临时高亮**，但**没有进入选中态**；而「选中节点 Enter = 就新建子级」的守卫要求 `selectedId === node.id`，于是第二次 Enter 被静默吞掉（toast 不抢焦点，只是同时出现，造成「被提示打断」的错觉）。设定树与大纲树同一根因（同一契约下的两个调用点）。

- [x] **T1 [BUG] 链式新建：新条目选中 + 聚焦**：`setting-tree.tsx` 的 `commitCreate` / `Outline.tsx` 的 `commitCreate` 成功后补设选中态（保留原高亮 + 聚焦）；契约写进 `layout.md` §7「链式新建」。验收：headless 键盘全链路（新建→Enter→Enter→输入→Enter）能连续建出子级，且焦点始终在最新行上。

---

## 已完成（批次二十）

| 卡 | commit | 内容 |
|---|---|---|
| T1 | `fix(client): 批次二十 T1 —— 语义色作用域修复` | cssVar key + `<html class>` 同值；守卫 `cssvar-scope`（实测锁定：改字面量即红） |
| T2 | `fix(chat): 批次二十 T2 —— 用户气泡底色` | `colorFillTertiary`；守卫 `primary-bg-token`；实测浅 `#f0eeec`/墨字、深 5.5% 白/81% 白 |
| T3 | `fix(timeline): 批次二十 T3 —— 组标题行补 px-3` | 组标题按钮列与事件卡按钮列对齐 |
| T4 | `fix(client): 批次二十 T4 —— 拖拽插入线与临时高亮可见化` | 共享 `DropIndicator`（primary 3px + 圆点）替换三处；落点/新建/定位高亮 → `bg-primary/10` + `ring-primary/30`（5 处） |
| T5 | `feat(client): 批次二十 T5 —— tint 标签系统` | `--tag-*` 六色 + `lib/tag-tint.ts`（FNV-1a，同名恒同色，静态类名表）+ `ui/tag-chip.tsx`；替换 9 处 chip；单测锁固定值/穷尽/边界 |
| T6 | `fix(client): 批次二十 T6 —— 图标按钮统一` | antd v6 `variant` 需配 `color` 的静默回落修复（22 处）+ 自绘图标按钮收敛 antd（8 处）+ 守卫 `button-variant-color` + 清 `lib/styles.ts` 死常量 |
| T7 | `feat(client): 批次二十 T7 —— 中栏页面头部统一` | 4 页补标题 + 7 页控件行重排 + 搜索框统一 `search-input` 规格 + 关联页新增建立关联入口 |

| T8 | `fix(client): 批次二十 T8 —— oracle 核验发现修复` | oracle 5 项必修 + 3 项风险全部处置（见下） |

**验证状态（T8 收口）**：五道门禁全绿（`designmd lint` 0 error/3 预期 warning、`pnpm typecheck`、`pnpm lint`、`pnpm -r test` 全仓用例、`pnpm -r build`）；headless 像素核验（浅/深/拖拽/落点四态）逐项实测通过。

**oracle 独立核验结论（read-only，逐卡核验 + 反例挖掘）**：
- T1/T2/T3 通过（T3 残留 1px 边框差，视觉不可感知）；T4 通过但漏 1 处（大纲 root-end）→ 已修；T6 通过但新增 1 处死类（`cursor-grab` 挂 antd Button 根）→ 已修 + 守卫纳入 `cursor-`；T7 基本通过但「搜索框最左」与控件行左序自相矛盾 → 契约定稿「搜索 → 分类 → 标签 → 排序」并把关联页搜索移到最左。
- T5 **不通过**：`TagChip` 取色 key 只看单个字符串 children，关系类型 chip（children 为 `[文案, " →"]` 数组）恒取首色 peach → 加显式 `label` prop 修复（像素复核已多色）。
- 风险项处置：`focus-strip` 色对齐契约（`bg-accent/40` → `bg-muted`）；控件行 Select 尺寸统一 32px；新增守卫 `no-dynamic-class`（拼接类名不生成）；修正 AntdProvider/index.css 里「注入 `:root`」的错误前提注释。

---

## 历史任务卡（批次十九，已全部完成）
