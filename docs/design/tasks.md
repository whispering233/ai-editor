# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 批次：P1 四处缺口（参考资料检索 / 已写未回收伏笔 / 大纲树筛选 / 画布按卷筛选）

### 共同约束

- **不新增工具**（工具数保持 49）：参考资料正文检索走既有 `search_references`，伏笔清单走既有 `analyze_hook_health` 的返回字段。⇒ **没有计数断言要改**。
- 数值/阈值的常量进 shared `constants/`，文档引用常量名不复述数字。
- 筛选是**组件态**：不写 localStorage、不进 URL、不重排（与画布既有口径一致）。
- 不要碰 `backlog.md` / `CHANGELOG.md` / `tasks.md`；不要 merge / push。

---

## C1 · AI 侧：参考资料正文检索 + 「已写未回收」伏笔

### C1.1 `search_references` 支持正文命中
- 参数加 `body?: boolean`（缺省 false = 现状：只匹配名称 + tags）。
- `body: true` 时命中面再加 `document_records.content_text`（`owner_kind='reference'`，`LIKE`，**不上 FTS5**）；命中来自正文的条目带 `snippet`（窗宽常量单源），来自名称/tags 的不带。
- 描述：写清 `body` 的语义与代价（全表扫、实测毫秒级），以及「不传 = 只搜名字与标签」（保持旧行为的可预期性）。

### C1.2 「已写未回收」伏笔（`written_unresolved`）
- **口径**：伏笔未软删、`status ∈ {planted, progressing}`、`data.expected_resolve_node_id` 已设置，且**该章已写过正文（`content_text` 非空）** ⇒ 记入「已写未回收」。
- **命名警告**：`analyze_hook_health` 已有 `overdue` 字段，含义是「龄期 > 半衰期 × 2」（时间衰减），**与本口径无关**。新字段必须叫 `written_unresolved`，且工具描述里点明两者区别（一个是时间衰减、一个是「该回收的章已经写了却没回收」）。
- db：新增查询（`listHooksWrittenUnresolved`），返回 `{ id, name, status, expectedResolveNodeId, expectedResolveChapterNumber, expectedResolveChapterTitle }`；章号走既有 `deriveChapterOrder` 口径，**不要另写遍历**。
- server：`GET /api/v1/hook/written-unresolved` → `{ hooks: [...] }`（无分页，单书命中量小）。
- tools：`analyze_hook_health` 返回体加 `written_unresolved` 数组（字段同上，camel→snake 按既有风格）。
- 文档：`docs/api/30-api-entity.md`（新端点）、`docs/api/tool-calling.md`（两个变化）。

**判据（硬）**：① `body` 命中正文且带 snippet、不传时行为不变 ② 已写未回收：命中的 4 个条件各有用例（未写正文不算、已回收不算、已废弃不算、无预计章不算）③ 章号与 `deriveChapterOrder` 一致 ④ 工具描述里同时出现两个词且说清区别 ⑤ 软删伏笔不出现。`pnpm -r build` + typecheck + lint + db/tools/server 测试绿（server 的两条 Windows 平台红排除，**并报告失败集是否恰好只有它们**）。

---

## C2 · 客户端：已写未回收（伏笔页 + 写作页 rail）

**依赖**：C1 的 `GET /api/v1/hook/written-unresolved`（`{ hooks: [{ id, name, status, expectedResolveNodeId, expectedResolveChapterNumber, expectedResolveChapterTitle }] }`）。若 C1 尚未合并，按此契约先行实现并 mock 测试。

- 伏笔页：列表行加「已写未回收」标记；页头加「只看已写未回收」筛选（组件态，不持久化）。
- 写作页 rail：「本章待回收 · N」块旁再加一行「已写未回收 · N」，点击跳 `#/hooks`（没有则不渲染，与既有块同一风格）。
- **判据（硬）**：① 标记与筛选各有用例 ② 切章不会再挂着上一章的数据（与既有「本章待回收」同一防抖口径）③ 无命中整块不渲染 ④ 空项目/接口失败时不影响写作页可用。client 测试绿、typecheck、lint 绿。

---

## C3 · 大纲树按标签 / 状态筛选（隐藏，不持久化）

- `lib/outline-tree.ts` 加纯函数 `filterOutlineNodes(tree, filters)`：命中节点**连同其祖先链**保留（否则子节点无处挂）；空结果返回空树。
- rail 页头加筛选控件（状态 / 剧情线标签）；**不要修改 `components/outline-canvas/` 下的筛选组件**（那是画布专用，并发卡在用）。
- **编号恒按全树**（`outline-numbering.ts` 口径不变——筛选不改「第 N 章」）。
- 筛选生效时**禁用拖拽**（落点在隐藏行上必然歧义），并在汇报里说明实现方式。
- **判据（硬）**：① 纯函数用例：命中 + 祖先链、无命中、多条件交集、软删节点 ② 筛选时编号不变 ③ 筛选态不能拖拽 ④ 不写 localStorage。client 测试绿、typecheck、lint 绿。

---

## C4 · 画布按卷筛选（淡化）

- 复用既有画布筛选（`lib/outline-canvas-filter.ts` + 工具条控件），**新增「卷」维度**：非本卷卡片淡化（与状态/剧情线筛选同一套「淡化不重排」实现）。
- **判据（硬）**：① 纯函数用例：按卷命中、与标签/状态叠加 ② 卡片位置不变（不重排）③ 不写 localStorage / 不进 URL ④ 工具条在窄屏不换行破版（报告一次像素或 DOM 断言）。client 测试绿、typecheck、lint 绿。