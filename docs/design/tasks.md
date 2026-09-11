# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。依据：`docs/design/architecture.md`（分包/技术栈）、`docs/api/`（API 契约）、`docs/db/schema.md`（数据结构）、`docs/ui/layout.md`（布局与交互红线）、`docs/ui/DESIGN.md`（**视觉契约**：颜色/字号/圆角/组件外观 + antd token 覆盖表）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；无待做项时不做 backlog 式顺手实现。
- 契约以 `docs/api`、`docs/db` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）；**视觉改动改完必跑** `packages/client` 的 `design-discipline.test.ts`（源码扫描硬约束，现 13 条规则）与 `designmd lint docs/ui/DESIGN.md`。
- **视觉改动顺序**：先改 `docs/ui/DESIGN.md`（契约）→ 再改 `AntdProvider.tsx`（token）→ 最后改调用点；反了必然产生「文档与实现两套事实」。
- **改完必须看像素**：类型检查与既有测试对 antd 的三类静默失效（无层 CSS 覆盖、cssVar 作用域、`color`+`variant` 组合）完全无感——headless 探针或 `pnpm start:test-project` 实测一次。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证后合回 main 清理分支。

---

## 当前任务卡

### T1 输入区配置行（模型 + 思考强度）下移 + 两端对齐 + 弹层不截断（用户反馈 #1#2）

- [ ] `ChatPanel.tsx`：`ChatModelBar` 移入 `InputArea` 内（`Sender` 下方），删掉 `disabled` 透传（输入区只在已打开项目时渲染）
- [ ] 配置行两端对齐：左 = 模型 Select，右 = 上下文占用 + 思考 Select；模型 Select 自然宽上限放宽（`max-w-28` → `max-w-48`，自然宽实测 135px）
- [ ] 模型 Select `popupMatchSelectWidth={false}`（浮层按内容宽，修「模型名选不全」）
- [ ] 文档：`layout.md §6.6`、`DESIGN.md` `composer-row` 条目（已改）
- [ ] 验证：`pnpm --filter @whispering233/ai-editor-client test` + `designmd lint` + playwright 像素（浅/深两态，浮层开合）

### T2 会话列表换 antd x `Conversations`（用户反馈 #3#4）

- [ ] `ChatPanel.tsx` `SessionTitleBar`：`AntDropdown + Menu` → `AntDropdown popupRender` + x `Conversations`（受控 `open`，选中即关）
- [ ] 会话项两行（摘要 + 「条数 · 相对时间」）；空历史 → 单条「暂无历史会话」禁用项；项高用 `styles.item` 抬到 auto
- [ ] 弹层宽度固定（不随摘要文本被撑爆）；`styles.root` 限高可滚
- [ ] 守卫：不再依赖 `Menu.itemSelectedBg`（Dropdown 自带 menu 样式不吃 Menu token——选中面实测 `rgb(120,119,113)` 不可读）
- [ ] 文档：`layout.md §6.1`、`DESIGN.md` `session-item` 条目（已改）
- [ ] 验证：同上 + 选中项/普通项计算样式探针（bg/字色对比）

### T3 面板收起/展开图标统一（用户反馈 #5）

- [ ] `NavRail.tsx` 收起：`MenuFoldOutlined` → `VerticalLeftOutlined`
- [ ] `ChatPanel.tsx` 收起：保持 `VerticalRightOutlined`（已是该族）
- [ ] `AppShell.tsx` `CollapseStrip` 展开：`BorderLeft/RightOutlined` → `VerticalRightOutlined` / `VerticalLeftOutlined`
- [ ] 文档：`DESIGN.md` `icon-button` 条目 + Do 清单（已改）
- [ ] 验证：playwright 像素（左右四钮 2×2 对照）

## 历史版本摘要（详情见 `CHANGELOG.md` / `milestone.md`，逐卡 commit 从 `git log` 回溯）

| 版本 | 内容 | 关键产出 |
|---|---|---|
| v0.0.29 | 用户反馈九项 + 静默失效根因 + 链式新建断链 | **P0**：antd cssVar 不注入 `:root` → 全站语义色透明（守卫 `cssvar-scope`）；**P0**：antd Button `variant` 需配 `color`（22 处 `variant="text"` 实为带边框 outlined，守卫 `button-variant-color`）；user 气泡 `colorPrimaryBg` 对比度 1.9:1（守卫 `primary-bg-token`）；标签 tint 系统（`--tag-*` 六色 + `lib/tag-tint.ts` hash 同名恒同色 + `ui/tag-chip.tsx`）；页面头部统一结构（标题行 + 控件行「搜索→分类→标签→排序 ／ 操作按钮」）；时间轴对称；共享 `ui/drop-indicator.tsx`（守卫 `no-dynamic-class`）；链式新建（就地新建后新条目进入「选中 + 聚焦」双态——设定树的选中须放在「新行已渲染并聚焦」的效应里，`reload()` 异步，提前设会被选中失效清理效应按旧树误判清零；契约 `layout.md §7「链式新建」`） |
| v0.0.28 | 视觉语言统一 | `docs/ui/DESIGN.md` 视觉契约（Notion 工作区暖灰 × antd 单一组件语言）；组件语言收敛 antd（自绘按钮/输入框/提示/下拉退役、22 处原生 `<select>`→`Select`、sonner→`message`）；图标单点化 `@ant-design/icons`；排版四档制 + `PageTitle`；`design-discipline.test.ts` 建立 |
| v0.0.27 | 用户反馈七项 | 实体列表去一级化残留；面包屑移除；「问 AI」迁中栏右下悬浮按钮；`Ctrl/Cmd+S` 保存快捷键；新建即聚焦；右栏 focus 小条显名称 |
| v0.0.26 | antd 全站迁移 + 布局重构 | 三栏布局（书架主页 `#/` + 左栏一级导航九项 + 右栏常驻）、路由一级化、@ant-design/x 会话渲染族、全站无二级 tab |

更早版本（v0.0.1–v0.0.24：地基/切片 1-13/阶段 U/B/C/B2/画布移除/早期用户反馈/发布链路/llm 换核/参考资料/设定树/多 provider）见 `milestone.md` 与 `CHANGELOG.md`。
