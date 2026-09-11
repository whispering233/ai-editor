# 开发任务清单（Task Cards）

开发任务卡，**垂直切片**组织。契约依据：`docs/api/`、`docs/db/schema.md`（字段/端点）、`docs/ui/layout.md`（布局与交互红线）、`docs/ui/DESIGN.md`（**视觉契约**：颜色/字号/圆角/组件外观 + antd token 覆盖表）。

**执行纪律**：

- 一次只做一张卡，验证通过（含测试）才算完成，然后独立 commit（一卡一 commit，回滚 = revert 该 commit）；卡内不做卡外顺手改动。
- 契约以 `docs/api`、`docs/db` 为准；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**视觉改动额外跑** `designmd lint docs/ui/DESIGN.md` + `packages/client` 的 `design-discipline.test.ts`（14 条源码守卫）与 `antd-tokens.test.ts`（5 条派生 token 守卫）。
- **视觉改动顺序**：先改 `docs/ui/DESIGN.md`（契约）→ 再改 `AntdProvider.tsx`（token 唯一入口）→ 最后改调用点。
- **改完必须看像素**：类型检查与既有测试对 antd 的静默失效（无层 CSS 覆盖、cssVar 作用域、`color`+`variant`、派生 token 对比度）完全无感——headless 探针或 `pnpm start:test-project` 实测一次。
- 并行卡片用临时分支 + git worktree（细节见根 `AGENTS.md`）。

---

## 当前任务卡

> 本轮：设置页信息架构重构（二级 tab + AI 模型三级导航）+ 中栏页头统一壳（标题/tab/控件行 + 分割线）+ 左栏「立即备份」快捷入口。
> 契约源：`docs/ui/DESIGN.md`（T1 定稿：§Layout「中栏页头结构」、§Components `tabs` / `sub-nav`、覆盖表 Tabs 行）。

### T1 契约：中栏页头结构 + Tabs token

- [ ] **契约**：`DESIGN.md` §Layout 新增「中栏页头结构」（标题行 → 二级 tab 行 → 控件行 → 分割线 → 内容；有 tab 用 tab 条自带底线、无 tab 用显式 1px `{colors.hairline}`；同宽不穿透；全部中栏页面含详情页/概览/回收站/书架）；§Components 新增 `tabs` / `sub-nav` 契约；覆盖表新增 `Tabs` 行（`horizontalMargin: 0` / `itemColor`）；修正「无二级 tab」表述为「无路由级 tab」
- [ ] **实现**：`AntdProvider.tsx` 加 Tabs 组件 token（浅/深两套 `horizontalMargin: "0"` + `itemColor` 取次级文字档）；`antd-tokens.test.ts` 加守卫（两态 horizontalMargin 归零、itemColor = 次级文字档）
- [ ] **验收**：`designmd lint docs/ui/DESIGN.md` error 清零；`pnpm --filter @whispering233/ai-editor-client test` 全绿；探针实测（浅/深）tab 底线紧贴内容无 16px 空档

### T2 PageHeader 壳 + 列表/富页迁移

- [ ] **实现**：新增 `components/ui/page-header.tsx`（`title` / `tabs?` / `controls?`；有 tabs → 不画显式分割线；无 tabs → 画 1px `border-border`）；迁移 10 页：概览、书架、大纲、人物/设定/地点/关联、伏笔、时间轴、参考资料、回收站
- [ ] **约束**：Timeline / ReferenceList 为 `flex h-full min-h-0 flex-col` 内滚动布局，PageHeader 须 `shrink-0`；搜索框仍在控件行最左；不做卡外改动
- [ ] **验收**：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`；逐页像素对照（迁移前后各一次）

### T3 详情页迁移

- [ ] **实现**：4 页（EntityDetail / OutlineDetail / TimelineDetail / ReferenceDetail）套 PageHeader；分割线落在元信息行之下；`ReferenceDetail` 可编辑标题与草稿态行为不变
- [ ] **验收**：同上 + 草稿态/编辑态手测（新建 md / 新建外源链接 / 标题点击编辑）

### T4 设置页二级 tab 骨架

- [ ] **实现**：`Settings.tsx` 三块下沉为 `settings/llm-section.tsx` / `settings/project-rules-section.tsx` / `settings/backup-section.tsx`（已有）；`Tabs` line 型 3 项（AI 模型 → 项目规则 → 备份），纯组件 state（默认 `llm`，不进 URL）；卸载无用的 `max-w-2xl mx-auto` 容器（页头与其他页对齐）
- [ ] **约束**：各 tab 内容组件自带加载与草稿（Tabs 懒渲染）；切回 tab 草稿保留；无项目态文案不变
- [ ] **验收**：切 tab 数据不串、草稿保留；无项目态引导文案不变；`pnpm -r test`

### T5 AI 模型 tab 三级导航

- [ ] **实现**：左侧竖向 `Menu`（160px，provider 列表，选中 = `menu-item-selected` 灰面）+ 右侧 provider 面板（裸区块：标题行 + 「当前」徽标 + 模型 `Select` + key 状态/输入/保存/清除）；常驻说明 Alert 落 tab 内容底部
- [ ] **约束**：provider 名超宽截断 + `title` 提示；模型 `Select` 保留 `popupMatchSelectWidth={false}`；「当前」徽标随选中 provider 显示
- [ ] **验收**：两家 provider 全路径手测（切 provider / 激活模型 / 存 key / 清 key）；对比度与选中面像素实测

### T6 左栏「立即备份」

- [ ] **实现**：`NavRail` 底部区最上（设置之上）加 `Button block color="default" variant="text"` + `SaveOutlined` + 「立即备份」；`config === null` 禁用；`loading` 防连点；`POST /project/backup` 无 name；toast 文案对齐 `BackupSection.handleBackupNow`
- [ ] **验收**：无项目禁用；点击后设置页备份列表出现新条目（`kind=manual`）；失败态 toast 透传

### T7 悬空引用清理 + CHANGELOG

- [ ] **实现**：全仓 `layout.md` 引用（19 处：`AGENTS.md` / `docs/design/{tasks,architecture,config}.md` / `DESIGN.md` 自身 / 10 处代码注释）改指 `docs/ui/DESIGN.md`（写节名，不写 §编号）；`CHANGELOG.md` 加本轮条目
- [ ] **验收**：`grep -rn "layout.md" .`（除 node_modules）零命中；`pnpm typecheck` / `pnpm lint` / `pnpm -r test` 全绿
