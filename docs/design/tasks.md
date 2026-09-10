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

## 当前任务卡

（无）
