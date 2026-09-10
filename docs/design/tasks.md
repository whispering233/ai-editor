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

- [ ] **T1 主题 token 落地**：`AntdProvider.tsx` 写入 seed（`colorPrimary/Text` `#37352f`、`colorLink` `#0075de`、`colorBgLayout` `#f6f5f4`、`colorBgContainer` `#ffffff`、`colorBorder` `#e5e3df`、`colorBorderSecondary` `#ede9e4`、文字阶梯、语义三色）+ 组件 token 覆盖表（Button 三 shadow = `none`、Menu 五项、Table 三项、Input/Select `activeShadow: none`、Select `optionSelectedBg`、Tag `defaultBg`）；`index.css` 删除 `--font-serif`/`--font-heading` 与衬线引用。判据：DESIGN.md §Colors 映射表逐行能在代码中对应；浅/深两态走查无「蓝色残留」（antd 默认主色）。
- [ ] **T2 页头统一**：新建 `PageTitle` 薄壳（`Typography.Title level={4}`，20px/600）；替换 `<h1 className="text-xl font-semibold">`（Outline/HookPanel/Timeline 等）、`Typography.Title level={4}`（Trash/Settings/ReferenceList）、`level={5}` 区块标题用法统一。判据：`grep -rn "<h1" src` 为空；页面标题来源唯一。
- [ ] **T3 字号档与 `!` 覆盖清理**：删 `text-[10px]`/`text-[11px]`/`text-[0.8rem]`（并入 `text-xs`）；清理 43 处 `!` 前缀 antd 类（改走 token 或包一层）。判据：`grep -rn "text-\[" src` 仅剩布局类；`grep -rn 'className="[^"]*!' src` 为空。
- [ ] **T4 卡片与空态收敛**：`SectionCard` 内部换 antd `Card`、`EmptyState` 内部换 antd `Empty`（对外 props 不变，调用点零改动）；散落的手写 `rounded-xl border` 容器（约 15 处）逐一处置——是卡片则换 `Card`，是内衬小框则留 utility。判据：手写卡片容器归零（或逐处有理由）；`Empty`/`EmptyState` 视觉统一为虚线卡。
- [ ] **T5 按钮收敛**：17 文件 `ui/button` → antd `Button`（variant 映射：`default`→`type="primary"`、`outline`→默认、`ghost`→`type="text"`、`destructive`→`danger`、`link`→`type="link"`）；删除 `components/ui/button.tsx`；ChatPanel 的 `Button as AntButton` 别名回正。判据：`grep -rl "components/ui/button"` 为空；文字型按钮均带边框（H4 红线）。
- [ ] **T6 输入框收敛**：`inputClass` 17 处 + `ui/input.tsx`（8 文件）→ antd `Input`（含行内编辑场景）；聚焦态统一 1px 描边（无环）。判据：`grep -rn "inputClass"` 仅剩 styles 定义或为空；全站 focus 观感一致。
- [ ] **T7 图标收敛 + 删 lucide**：19 文件 37 图标 → `@ant-design/icons`（映射表见对话记录 / DESIGN.md 图标纪律：状态 Filled、操作 Outlined、尺寸随 `text-*`）；`package.json` 删 `lucide-react`。判据：`grep -rn "lucide-react" src` 为空；`pnpm build` 通过；图标尺寸/风格走查无混排。
- [ ] **T8 反馈层收敛 + 删 sonner**：`AntdProvider` 加 `<App>` 包裹；`FeedbackHost` 改 `App.useApp().message`（`ToastKind` → `message.success/error/info`，`duration: 3` 对齐 store 定时器）；删 `components/ui/sonner.tsx` + `sonner` 依赖；`FeedbackHost.test.tsx` 的 `shouldNotifyToast` 判定函数保留并适配。判据：`grep -rn "sonner" src` 为空；提示位置/时长走查。
- [ ] **T9 视觉纪律守卫**：新增单测（如 `packages/client/src/design-discipline.test.ts`）扫描源码禁止项——lucide 导入 / 硬编码色值（`#[0-9a-f]{3,6}`、`rgb(`、`hsl(` 白名单除外）/ `!` 前缀 antd 类 / 手写字号类；DESIGN.md 的 `designmd lint` 纳入验证步骤。判据：测试能对当前已收敛代码通过、对违规样例失败。
- [ ] **T10 收尾**：`lib/book-cover.ts` 硬编码 `hsl()` 处理（改 token 化或限制在浅色态）；`index.css` 残留清理核对；`milestone.md`/`CHANGELOG.md` 批次记录；`DESIGN.md` 与实现二次对齐（lint 复跑）。

**风险与返工点**：① T5/T6 触及 25 文件，属机械替换但回归面广——建议每卡完成后按页面走查一遍（大纲/人物/设定/地点/伏笔/时间轴/关联/参考资料/回收站/设置/书架）；② antd `Empty`/`Card` 默认内边距与旧自绘不同，虚线卡视觉需微调；③ `message` 位置由右上变顶部居中（已确认接受）；④ `font-serif` 删除会让 Dashboard 书封以外的「文学感」消失——书封是刻意保留的唯一例外。
