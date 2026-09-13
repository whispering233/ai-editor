# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（历史在 `CHANGELOG.md`，未排期的遗留项在 `backlog.md`）。**新发现的小项一律进 `backlog.md`，不即时插队。**

---

## 当前任务卡

### 卡 10.6 — 中性徽标可读性：`TypeChip` 字色提到 primary（用户实测「不够明显」）

**问题**：实测底 `#f0eeec` 与白画布仅 **1.16:1**（tint peach 也只有 1.18——tint 靠色相、中性底无色相），可读性全靠字色；10.1 选的 tertiary `#787671` 只有 **3.92:1** ⇒ 灰底淡斑。

**任务卡**：
- [x] 10.6 `TypeChip` 字色 `text-muted-foreground` → `text-foreground`（primary，10.59:1，与 `TagChip` 同档；两形态只差底色有无色相）；`DESIGN.md` `type-badge.textColor` 改 `{colors.primary}` 并登记对比度事实；`tag-chip.test.tsx` 断言同步

**验证**：`pnpm typecheck` / `pnpm lint` / 测试；构建后浏览器实测 computed style

---

## 批次记录（已完成）

批次 1 章级锚点收窄 → 批次 2 人物数据模型与能力面板 → 批次 3 人物页工作台 → 批次 4 全量验证与发布（v0.0.34）→ 批次 5 延期项速清 → 批次 6 人物页信息架构与文案 → 批次 7 选择器口径统一（7.1 进度节点仅章 / 7.2 预计回收节点同口径）→ 批次 8 关系区收口（8.1 关系类型属性注册表 + 对称口径统一 / 8.2 自定义关系类型 + `select-free-input` / 8.3 人物字段清单 schema 一致性断言 / 8.4 人物关系星形图）→ 批次 9 UI 收口（9.1 关联总览列左对齐 / 9.2 大纲行尾徽标不推移删除按钮 / 9.3 进度节点下拉可搜索 / 9.4 删除星形图）→ 批次 10 标签 tint 准入收口（10.1 新增中性 `TypeChip` + 组件级守卫 / 10.2 类型徽标转中性（大纲·回收站·关联）/ 10.3 同语义灰 chip 统一（伏笔 category·人物关系类型）/ 10.4 实体详情「其他关联」关系类型 + `status-badge` 口径去 tint / 10.5 浏览器像素核）。逐版本事实见根 `CHANGELOG.md`。
