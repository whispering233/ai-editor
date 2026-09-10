# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/` 各模块文档（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 项目状态（2026-09-10，v0.0.27 已打 tag）

v0.0.1-v0.0.26 发布链路全绿；**v0.0.27 = 批次十八：用户反馈七项修复与优化**（纯前端交互层，API/数据零改动，逐批独立代理验证）——中栏右下悬浮「问 AI」（点击必有反应）、`Ctrl/Cmd+S` 保存快捷键、新建即聚焦、focus 小条显示实体名称、实体列表页去一级化残留、面包屑整站移除、设定树拖拽插入线强化、死代码 `hooks/use-api.ts` 清理；逐卡 commit 见 git log（A1/A2/A3 → B1/B2 → C1/C2 + 验证跟进修复）。v0.0.26 = 批次十七：antd 全站迁移 + 布局重构 + 会话渲染重做（antd v6 cssVar 主题基座、书架主页/概览拆分、NavRail 一级导航、路由一级化、@ant-design/x 会话渲染、@base-ui/react 退役）。

**无待做项（v0.0.27 已收口）**；**批次十九「视觉语言统一」规划中——卡片清单见下，待用户审阅后开工**；迭代演进路线见 `milestone.md`；运行/构建/发布手册见 `build.md`；版本史见根 `CHANGELOG.md`（历史批次执行明细与逐卡 commit 从 `git log` 回溯）。

---

## 当前任务卡

### 批次十九：视觉语言统一（Notion 工作区 × antd 单一组件语言）

**背景**：批次十七迁 antd 后遗留四套平行体系（标题 3 种来源、图标 2 套、按钮 3 套、空态 2 套），造成「同一页面两种 focus 态/两种圆角」的观感混乱。本批次一次性收敛，**纯前端渲染层，API/数据零改动**。

**已定决策（视觉契约 = `docs/ui/DESIGN.md`，实现前先读）**：
1. 基调：antd token 轻定制，值取 Notion **工作区**（非营销站）——暖灰 + hairline + 扁平 + 灰阶；营销站的紫 CTA / navy hero / 马卡龙大面 / 胶囊按钮一律不采用
2. `colorPrimary` = `colorText` = `#37352f` 墨黑；`colorLink` = `#0075de`（链接蓝独立）
3. 组件语言收敛 antd：删 `ui/button`；`SectionCard`/`EmptyState` 内部换 antd `Card`/`Empty`（调用点零改动）；`inputClass` → antd `Input`；标题统一 `PageTitle` 薄壳；自绘浮层（context-menu / dialog / popover / searchable-select / suggestion-datalist）**保留不动**
4. 图标收敛 `@ant-design/icons`；删 `lucide-react`
5. 字号四档 20/16/14/12；删 10/11px 与 `0.8rem`；`font-serif` 只留书封
6. 反馈层收敛 antd `message`；删 `sonner`

**卡序（串行，避免同文件并行冲突）**：T1 → T2 → T3 → T4 → T5 → T6 → T7 → T8 → T9 → T10。每卡一个 commit，实现 fixer + 验证 oracle 双代理。

- [x] **T1 主题 token 落地**（完成）：`AntdProvider.tsx` 写入**浅/深两套** seed（`colorPrimary/Text`、文字阶梯、`colorBgLayout/Container/Elevated`、描边三层 `colorBorder`/`colorBorderSecondary`/`colorSplit`、`colorLink`、语义三色）+ `controlOutlineWidth: 0`（关闭 selector 型组件聚焦环）+ 组件覆盖（Button 三 shadow、Menu、Table、Input `activeShadow`、Select `optionSelectedBg`、Tag `defaultBg`）；`index.css` 删 `--font-serif`/`--font-heading`、圆角钉到 4/6/8（旧 `calc(--radius*k)` 派生 9.6/7.7/5.8 与文档不符已修）。实现要点：`theme.token` 显式值由算法派生后覆盖（不被再加工），故必须分模式写 token。验证：`designmd lint` 0 error / `pnpm typecheck` / `pnpm lint` / client test 540 passed / client build 均绿。
- [x] **T2 页头统一**（完成）：新建 `PageTitle` 薄壳（`Typography.Title level={4}` = 20px/600/1.4）并替换**全站 11 处页面级标题**（含 4 个详情页；`<h1` 手写与裸 `level={4}` 均清零）；`Typography.titleMarginBottom: 0` 组件 token 接管标题下边距（不在壳内内联绕）；连带清掉 3 处 `!mb-*` 与 `ReferenceList` 无用导入；chrome 崇线清除：`NavRail` 产品标识、`InfoBar` 项目名、`dialog.tsx` 失效 `font-heading`、`ReferenceDetail` 可编辑标题（含编辑态 input）、`ErrorBoundary` 异常标题、`Dashboard` 两处空态引导标题（`text-lg` 18px 不在四档内 → `text-base font-semibold`）。验证：designmd lint 0 error / typecheck / lint / client test 540 passed / build 均绿。**残留归卡**：`section-card.tsx` 的 `font-serif` 区块标题 → T4；`Dashboard:901` 书封崇线 → T10；`level={5}` 的 3 处 `!mb-1` → T3。
- [x] **T3 字号档与 `!` 覆盖清理**（完成）：`!` 前缀类 **74 处 → 0**（8 文件）；手写字号 10px/11px/0.8rem **5 处 → 0**（仅剩 T5 将删的 `ui/button.tsx` 一处）。处置规则：12px caption 改用原生 `<span>/<p className="text-xs …">`（不再给 `Typography.Text` 挂 `!text-xs`）；间距（`!mb-/!mt-/!mr-/!py-/!ml-auto`）移交父容器；结构性类改父布局或删无操作类；NavRail 的 `!border-none !bg-transparent` 改 Menu 组件 token（`itemBg: transparent` / `activeBarBorderWidth: 0`，已登记 DESIGN.md 覆盖表）。**例外**：`create-relation-dialog` 的装饰箭头 `→` 用 `text-xl`（`aria-hidden`，非排版档，不计违规）。验证：designmd lint 0 error / typecheck / lint / client test 540 passed / build 均绿。
- [x] **T4 卡片与空态收敛**（完成）：`SectionCard` → antd `Card`（标题 `Typography.Title level={5}`，删 `font-serif`；经 `Card.bodyPadding: 16` token 定内边距，不用自带表头）；`EmptyState` → 内部 antd `Empty`（`image={false}` 去插图 + 虚线卡基座保不变，对外 props 不变）；5 处直用 antd `Empty` → `EmptyState`（现全仓直用点 0）；**antd preset 色 Tag 清零**（`EntityList:564/589`、`ReferenceList:468`、`Settings:224`、`backup-section:323` 条件蓝）；半径越档归一：`rounded-2xl→rounded-lg`（Dashboard 560/827）、`rounded-xl→rounded-lg`（ErrorBoundary callout、`ui/dialog` 浮层）；删死代码 `lib/styles.ts` 的 `sectionCardClass`；新增 2 个组件测试（`section-card.test.tsx` / `empty-state.test.tsx`，锁 Card/h5/无宗线与空态无插图）。验证：designmd lint 0 error / typecheck / lint / client test **544 passed** / build 均绿。**计数修正**（卡面估算 vs 实际）：SectionCard 调用点 9 处（非 11）、EmptyState 现有调用点 8 处（非 7）、收敛后 EmptyState 调用点共 17 处。
- [x] **T5 按钮收敛**（完成）：19 个 `ui/button` 调用点 → antd `Button`（导入统一 `from "antd"`）；删 `components/ui/button.tsx`（死代码由父会话补删）；`ChatPanel` 的 `Button as AntButton` 别名回正；`size="middle"` → `medium`（v6 已弃用别名）；自绘尺寸档清零（`xs/sm/icon-sm/icon-xs` → antd `small/medium`，按「行内→small 24 / 表单与主操作→medium 32」逐点判定，DESIGN 控件高只有 32/24/40）；`buttonVariants` 的 3 处 `<a>` 改 `<Button href>`。**H4 边界**：12 处 `variant="text"` 全为 icon-only（带 `aria-label`，豁免）+ `NavRail` 三个导航入口（与 Menu 项同级，豁免）；已写入 DESIGN.md 规则。**连带修正**：NavRail 选中态去内联 style（`token.colorPrimaryBg` 彩色底 → `bg-accent` = `surface-muted` 灰面）、左栏底色改 `bg-background`（surface）且分栏线改 `border-border`；种子新增 `colorFillTertiary`（= `surface-muted`，Tailwind `--accent` 转发）；`index.css` 的 `--border` 改映射 `colorBorderSecondary`（结构描边）而 `--input` 仍映射 `colorBorder`（交互描边）。验证：designmd lint 0 error / typecheck / lint / client test 544 passed / build 均绿。22 文件 +195/−549（净减 354 行）。**遗留至 T10**：`class-variance-authority` 依已无消费者（原唯一消费者是被删的 `ui/button`）；`ChatPanel` 若干内联 style 用 `token.color*` 给图标上色，可后续改语义类。
- [ ] **T6 输入框收敛**：`inputClass` 17 处 + `ui/input.tsx`（8 文件）→ antd `Input`（含行内编辑场景）；聚焦态统一 1px 描边（无环）。判据：`grep -rn "inputClass"` 仅剩 styles 定义或为空；全站 focus 观感一致。
- [ ] **T7 图标收敛 + 删 lucide**：19 文件 37 图标 → `@ant-design/icons`（映射表见对话记录 / DESIGN.md 图标纪律：状态 Filled、操作 Outlined、尺寸随 `text-*`）；`package.json` 删 `lucide-react`。判据：`grep -rn "lucide-react" src` 为空；`pnpm build` 通过；图标尺寸/风格走查无混排。
- [ ] **T8 反馈层收敛 + 删 sonner**：`AntdProvider` 加 `<App>` 包裹；`FeedbackHost` 改 `App.useApp().message`（`ToastKind` → `message.success/error/info`，`duration: 3` 对齐 store 定时器）；删 `components/ui/sonner.tsx` + `sonner` 依赖；`FeedbackHost.test.tsx` 的 `shouldNotifyToast` 判定函数保留并适配。判据：`grep -rn "sonner" src` 为空；提示位置/时长走查。
- [ ] **T9 视觉纪律守卫**：新增单测（如 `packages/client/src/design-discipline.test.ts`）扫描源码禁止项——lucide 导入 / 硬编码色值（`#[0-9a-f]{3,6}`、`rgb(`、`hsl(` 白名单除外）/ `!` 前缀 antd 类 / 手写字号类；DESIGN.md 的 `designmd lint` 纳入验证步骤。判据：测试能对当前已收敛代码通过、对违规样例失败。
- [ ] **T10 收尾**：`lib/book-cover.ts` 硬编码 `hsl()` 处理（改 token 化或限制在浅色态）；`index.css` 残留清理核对（含 `--radius`/`--radius-xl+` 遗留 tail）；`antd-smoke.test.tsx` 测试名「默认色板暗色算法」语义已过期一并修正；`milestone.md`/`CHANGELOG.md` 批次记录；`DESIGN.md` 与实现二次对齐（lint 复跑）。

**风险与返工点**：① T5/T6 触及 25 文件，属机械替换但回归面广——建议每卡完成后按页面走查一遍（大纲/人物/设定/地点/伏笔/时间轴/关联/参考资料/回收站/设置/书架）；② antd `Empty`/`Card` 默认内边距与旧自绘不同，虚线卡视觉需微调；③ `message` 位置由右上变顶部居中（已确认接受）；④ `font-serif` 删除会让 Dashboard 书封以外的「文学感」消失——书封是刻意保留的唯一例外。
