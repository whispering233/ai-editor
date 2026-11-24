# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 批次：千章书的 AI 侧导航与检索

### 背景（实测）：1000 章 / 157 万字下，`get_outline` 全树 = 197,107 token，去 `updatedAt` + 只到章仍 = 127,388 token，**全部远超单条工具结果上限 `TOOL_RESULT_MAX_TOKENS`**；单卷（50 章）= 6,352 token。⇒ 大纲不能再当 payload 返回，必须改成「地图 → 放大 → 检索」。

### 共同约束（三卡都要守）
- 工具数 **47 → 49**：`shared/src/constants/tool.ts` 清单与计数注释、`shared/.../constants.test.ts` 的计数断言、`tools/src/index.test.ts` 的逐名清单与计数断言，**一处不漏**（漏一处会静默漂移）。
- 三件都是**只读工具**（`permission: AUTO`、`scope: "novel"`），**不进 `PROPOSAL_TOOLS`**。
- 分页/截断沿用既有口径：`total` + `truncated` + `next_offset`（参照 `search_entities`）；上限常量单源，不写字面量。
- 检索走 **`LIKE`**，**不引入 FTS5**（实测 157 万字全表扫 5–9ms）。
- 文档：`docs/api/tool-calling.md` 的目录与说明段同步。
- 不要碰 `backlog.md` / `CHANGELOG.md`（主会话合并后统一改）。

---

## C1 · `get_outline` 分层 + 卷聚合

- **参数**：`depth?: 1 | 2 | 3`（**缺省 1**）+ `volume_id?: string`。
  `depth` **从树根算层数**：1 = 只回卷；2 = 卷 + 章；3 = 卷 + 章 + 场景。`volume_id` 只是**过滤**（只保留该卷，`depth` 语义不变）。
- **行为**
  1. **所有档位都不再返回 `updatedAt`**（模型不需要它；它占原 payload 的 27%）。
  2. `depth=1` 的卷节点带聚合：`{ chapterCount, charCount, draftCount, finalCount }`。数值口径：只计未软删节点；`charCount = SUM(LENGTH(content_text))`（与 `with_metadata` 的 `textLength` 同义）；`draftCount` / `finalCount` 按 `data.status` 计，**`json_valid` 守卫**，且**缺省 status = draft**（与 `lib/outline-detail.ts` 的缺省等价口径一致）。
  3. `volume_id` 不存在 → 抛错（不是回空树）。
- **描述改写**：说明 depth 三档、千章场景该怎么用（先 `depth=1` 看地图 → `volume_id` 放大 → 检索跨卷定位）、不再返回时间戳。
- **判据（硬）**：三档节点数递增正确；`volume_id + depth=2` 只回该卷的章；聚合四个数有用例；软删不计入；`updatedAt` 在所有档位都不出现。`pnpm -r build` + `typecheck` + `lint` + `pnpm --filter @whispering233/ai-editor-tools test` + `pnpm --filter @whispering233/ai-editor-shared test` 绿；新 commit；`git status` 干净。

---

## C2 · `search_outline`（结构化检索）

- **参数**：`query?: string`、`status?: enum`、`tags?: string[]`、`volume_id?: string`、`offset?: number`；**至少一个条件**（全空 → 抛错，避免「列全书」）。
- **命中面**：节点 `title` / `summary` / `data.result_summary`（`LIKE`）；`status` / `tags` 为结构化过滤（tags 与 `listEntities` 同口径：**全含**）。
- **返回**：`{ items: [{ id, title, chapterNumber, volumeId, volumeTitle, status, tags, snippet }], total, truncated, next_offset? }`。
- **排序**：**阅读序**（卷序 → 卷内章序，复用既有 `deriveChapterOrder`，不要自己再排一遍）。
- **判据（硬）**：query 命中标题/计划摘要/实际摘要各一条用例；status + tags 组合过滤；`volume_id` 限定；全空参数抛错；分页 `next_offset` 连续两次取完不重不漏；软删节点不出现。`pnpm -r build` + `typecheck` + `lint` + tools/shared 测试绿；新 commit；`git status` 干净。

---

## C3 · `search_manuscript`（正文检索）

- **参数**：`query: string`（必填，空串/纯空白 → 抛错）、`offset?: number`。
- **实现**：`document_records.content_text LIKE %q%`（`owner_kind='chapter'`），**不上 FTS5**、不开迁移。
- **返回**：`{ items: [{ chapterId, chapterNumber, title, snippet }], total, truncated, next_offset? }`；`snippet` = 命中位置前后各取常量窗宽（**窗宽常量单源**，不写字面量），命中多处取第一处并标注省略。
- **排序**：阅读序（同 C2）。
- **判据（硬）**：命中章正文；空 query 抛错；分页连续两次取完不重不漏；`snippet` 含命中词且长度在上限内；**千章书 smoke**（`test-project/books/规模测试：千章`，若存在）单次调用 < 100ms 且结果 token 远低于上限。`pnpm -r build` + `typecheck` + `lint` + tools/shared 测试绿；新 commit；`git status` 干净。