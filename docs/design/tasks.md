# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（历史在 `CHANGELOG.md`，未排期的遗留项在 `backlog.md`）。**新发现的小项一律进 `backlog.md`，不即时插队。**

---

## 当前任务卡

### 卡 10.1 — 标签 tint 准入收口：类型/分类徽标改中性 `TypeChip`

**契约**：`docs/ui/DESIGN.md` §Colors「标签色」+ §Components `tag` / `type-badge`。

**背景（问题）**：着色实现 = `tagTint(文案)` 哈希取模 6，且 `TagChip` **任何文案都给色**（无准入规则）——于是同一类「枚举类型」在不同页面各行其是：大纲页卷/章/场有色、关联页源/目标类型与关系类型有色、回收站类型有色，而人物页 `role` 无色（字段非 chip）、阅读进度无色（状态另走灰徽标）。用户口径（本卡前提）：**tint 只给用户标签（`data.tags` 元素），枚举类型/分类徽标一律中性**。

**任务卡**（垂直切片，一卡一 commit）：
- [ ] 10.1 `components/ui/tag-chip.tsx` 新增 `TypeChip`（`bg-accent` + `text-muted-foreground`，尺寸/字号与 `TagChip` 一致）+ 头注释写准准入规则；新增 `components/ui/tag-chip.test.tsx`（`TagChip` 带 `bg-tag-*`；`TypeChip` 带 `bg-accent` 且不含 `bg-tag-*`）
- [ ] 10.2 类型徽标转 `TypeChip`：`pages/Outline.tsx`（列表行 + 就地新建行）、`pages/OutlineDetail.tsx`（元信息行）、`pages/Trash.tsx`（`TypeBadge`）、`components/entity/relations-view.tsx`（`EndpointBadge` 源/目标 + 关系类型两分支，同时去掉已无用的 `label={...}` 取色传参）
- [ ] 10.3 同语义既有灰 chip 统一到 `TypeChip`（消除「同语义两种灰」）：`pages/HookPanel.tsx` 列表行 `category` + 详情 `category`、`components/character/character-relations.tsx`（关系类型 / 双向）。**不动**：`HookPanel.tsx` 详情 `status`（状态非类型）、`components/delta/node-delta-list.tsx` 与 `components/delta/change-summary.tsx`（变更记录字段 chip）、大纲/详情页「阅读进度」徽标

**验证**：`pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test`；视觉改动额外浏览器核像素（大纲页、关联页、回收站页、人物页关系网、伏笔页）
**硬完成判据**：每张卡 `git log` 含新 commit 且 `git status` 干净；汇报必附 commit hash + 命令输出

---

## 批次记录（已完成）

批次 1 章级锚点收窄 → 批次 2 人物数据模型与能力面板 → 批次 3 人物页工作台 → 批次 4 全量验证与发布（v0.0.34）→ 批次 5 延期项速清 → 批次 6 人物页信息架构与文案 → 批次 7 选择器口径统一（7.1 进度节点仅章 / 7.2 预计回收节点同口径）→ 批次 8 关系区收口（8.1 关系类型属性注册表 + 对称口径统一 / 8.2 自定义关系类型 + `select-free-input` / 8.3 人物字段清单 schema 一致性断言 / 8.4 人物关系星形图）→ 批次 9 UI 收口（9.1 关联总览列左对齐 / 9.2 大纲行尾徽标不推移删除按钮 / 9.3 进度节点下拉可搜索 / 9.4 删除星形图）。逐版本事实见根 `CHANGELOG.md`。
