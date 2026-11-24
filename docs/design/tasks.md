# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 批次：章级历史（误操作找回）

### 背景与已定决策

- **只解决「误操作找回」**：短窗口、高密度、全自动；**不做**版本命名 / 差异对比 / 跨章浏览。
- **快照记「被覆盖的旧内容」**：保存时把 `existing.content` 压入历史；当前内容不进历史。
- **节流与去重放服务端**：内容与旧值相同 → 跳过；距该章上一份 < `CHAPTER_SNAPSHOT_MIN_INTERVAL_MS` → 跳过。客户端零改动、跨标签页天然一致。
- **恢复走独立端点，复用保存核心**：先**强制**压一份当前内容（绕过节流），再走与 `PUT` 相同的写入路径（提取共享函数，禁止复制一份保存逻辑）。
- **历史随 `data.db` 进备份 / 云端**（零额外代码：实测 12.2 MB 库 gzip 后 0.59 MB，近重复快照压缩率更高）。
- **不做自动 `VACUUM`**（独占锁会撞备份 tick）；上限管的是活跃数据量，不是文件大小。

### 共同约束

- 三个数值全部**常量单源**（shared `constants/`）：`CHAPTER_SNAPSHOT_MIN_INTERVAL_MS` / `MAX_SNAPSHOTS_PER_DOCUMENT` / `SNAPSHOT_BUDGET_MULTIPLIER`（全局预算 = 该书正文总量 × 该倍数）。文档与工具描述引用常量名并带同值断言，不手抄数字。
- 快照只存 `content`（块 JSON）+ `char_count`（整数），**不存** `content_text`（恢复时由共享派生函数重算）。
- 不要碰 `backlog.md` / `CHANGELOG.md` / `tasks.md`。

---

## C1 · 服务端切片（表 + 写入钩子 + 恢复端点）

- **迁移** `015_document_snapshots`：`owner_kind` / `owner_id` / `seq`（自增主键，**跨秒并发的排序键**）/ `content` / `char_count` / `created_at`；(owner_kind, owner_id, seq) 索引。建表 SQL 与迁移 DDL 逐字同形。
- **db 查询**（`queries/document-snapshots.ts`）：`insertSnapshotIfDue`（节流 + 去重判定）、`trimSnapshots`（每章 `MAX_SNAPSHOTS_PER_DOCUMENT` + 全局预算，均从最旧删）、`listSnapshots`、`getSnapshot`。
- **保存端点接入**（`routes/manuscript.ts` 的 PUT，`upsertDocument` 之前）：旧值存在且内容有变且过流控 → 压快照 → 裁剪。保存语义与响应**不得变化**。
- **恢复端点** `POST /manuscript/:id/restore`（body `{ snapshot_id }`）：强制压当前内容（绕过节流，当前内容与目标相同则幂等返回）→ 复用保存核心写入目标内容 → 返回与 PUT 同形响应。
- **读端点**：`GET /manuscript/:id/snapshots`（列表：seq / created_at / char_count，seq 降序）、`GET /manuscript/:id/snapshots/:seq`（单份 content）。
- **判据（硬）**：① 节流（< 间隔不产生第二份）② 去重（内容未变不产快照）③ 每章裁剪到上限 ④ 全局预算超限删最旧 ⑤ **恢复可逆**（恢复后还能退回恢复前那一版）⑥ 同秒多次保存排序稳定（按 seq）⑦ 恢复后 `updated_at` 推进、码字统计照既有口径。各有用例；`docs/db/schema.md` 与 `docs/api/110-api-manuscript.md` 同步。`pnpm -r build` + `pnpm typecheck` + `pnpm lint` + db/server 测试绿（server 的两条 Windows 平台红排除）；新 commit；`git status` 干净。

---

## C2 · UI 切片（写作页历史抽屉）

- 写作页 `PanelHeader` 动作组加「历史」24px 图标按钮（`HistoryOutlined`），与导出 / 回填摘要同排；抽屉复用 `PlotEdgeDrawer` 的姿势，**打开时右栏（AI 聊天）临时收起**，避免正文被挤到不可用。
- 抽屉列表：相对时间 + 绝对时间 + 字数 + 「比当前少/多 N 字」；点一条 → 只读预览（BlockNote `editable={false}`，不另写 md 渲染）→ 底部「恢复到此版本」→ 二次确认 → 调恢复端点 → 正文立即刷新 + 提示。
- 空历史：入口按钮禁用或抽屉空态（二选一，写进测试）。
- **判据（硬）**：① 恢复后正文与 `updated_at` 立即更新（不刷新页面）② 恢复前自动快照生效（恢复完还能再退回去）③ 抽屉 + 右栏 + 正文并存时正文宽度可用（实测一次，报告像素）④ 空态行为有测试。client 测试绿、typecheck、lint 绿；新 commit；`git status` 干净。