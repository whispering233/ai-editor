# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`（视觉改动额外用浏览器看一次像素）。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（历史在 `CHANGELOG.md`，未排期的遗留项在 `backlog.md`）。**新发现的小项一律进 `backlog.md`，不即时插队。**

---

## 当前任务卡

### 卡 7.1 进度节点选择器收窄为仅章（人物页 + 通用 compute 探针）

- [ ] `chapterNodeOptions` / `chapterNodeExists` 从 `lib/hook-panel.ts` 挪到 `lib/outline-tree.ts`（通用大纲 helper 归位），用例随之进 `outline-tree.test.ts`
- [ ] 人物页「阅读进度」tab：选项 = `chapterNodeOptions(outline)`（props 由 `outlineNodes` 改名 `chapterNodes`）；失效判据 / 默认进度节点同源收窄到章
- [ ] `compute-preview.tsx`（设定/地点/人物详情页通用的 compute 探针）：选项与默认值同样收窄为章
- [ ] 契约不变：`POST /delta/compute` 与工具 `compute_state` 的 `at_node_id` **仍不限层级**（非章入口只存 API/工具层）——`schema.md` / `10-data-model.md` 补这句分层
- [ ] 测试：`outline-tree.test.ts` 断言「卷/场景/软删不入选项」；`character-detail.test.ts` 补「存量指向场景 → 判 invalid（提示去大纲重设）」
- [ ] 验证 oracle：浏览器核一次下拉选项不含卷/场景 + 全量回归

---

最近完成：批次 1 章级锚点收窄（1.1–1.9）→ 批次 2 人物数据模型与能力面板（2.1–2.9）→ 批次 3 人物页工作台（3.1–3.6 + 两轮修复）→ 批次 4 全量验证与发布（`CHANGELOG v0.0.34`）→ 批次 5 延期项速清（5.1–5.6）→ 批次 6 人物页信息架构与文案（6.1–6.3）。
