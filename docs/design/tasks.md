# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（历史在 `CHANGELOG.md`，未排期的遗留项在 `backlog.md`）。**新发现的小项一律进 `backlog.md`，不即时插队。**

---

## 当前任务卡

### 卡 9.1 关联总览三列左对齐

- [ ] `relations-view.tsx` 列表模式：关系类型列去 `justify-center`（与源/目标列、表头同左对齐）
- [ ] `DESIGN.md` §数据展示登记列对齐口径
- [ ] 验证：`pnpm --filter @whispering233/ai-editor-client test` + 浏览器像素

### 卡 9.2 大纲行尾徽标不推移删除按钮

- [ ] `Outline.tsx` 节点行：阅读进度徽标排在删除按钮**左侧**（删除按钮恒贴行尾，跨行不位移）
- [ ] `DESIGN.md` §数据展示 `data-row` 登记「行尾状态徽标不得推移操作按钮」
- [ ] 验证：typecheck/lint + 浏览器像素（设当前位置的章行）

### 卡 9.3 人物页进度节点下拉支持搜索

- [ ] `character-detail.tsx` 阅读进度 tab：进度节点 `Select` 加 `showSearch` + `optionFilterProp="label"`
- [ ] `DESIGN.md` `character-workbench` 进度节点选择器登记搜索口径（antd 默认按 value 过滤的坑）
- [ ] 验证：client 测试 + 浏览器像素（输入章名可筛出）

### 卡 9.4 删除人物关系星形图

- [ ] 删 `components/character/relation-star-graph.tsx`、`lib/relation-star.ts`、`lib/relation-star.test.ts`
- [ ] `character-relations.tsx`：去 import / 去渲染 / 去 `selfName` prop（容器与走查测试同步）
- [ ] 文档：`DESIGN.md` 删 `relation-star-graph` 段 + `character-relations` 段同步；`backlog.md` 删星形图登记项；`AGENTS.md` 人物页条目同步；`CHANGELOG.md` 记 Removed
- [ ] 验证：typecheck/lint/test + 浏览器像素（关系网 tab 无图）

---

## 批次记录（已完成）

批次 1 章级锚点收窄 → 批次 2 人物数据模型与能力面板 → 批次 3 人物页工作台 → 批次 4 全量验证与发布（v0.0.34）→ 批次 5 延期项速清 → 批次 6 人物页信息架构与文案 → 批次 7 选择器口径统一（7.1 进度节点仅章 / 7.2 预计回收节点同口径）→ 批次 8 关系区收口（8.1 关系类型属性注册表 + 对称口径统一 / 8.2 自定义关系类型 + `select-free-input` / 8.3 人物字段清单 schema 一致性断言 / 8.4 人物关系星形图）。逐版本事实见根 `CHANGELOG.md`。
