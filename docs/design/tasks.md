# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### stats-1-backend — 码字日统计的数据与接口

**依赖**：无（可与 `stats-3-hud` 并行）。

**契约**：`docs/db/schema.md`「writing_stats_daily」；`docs/api/130-api-writing-stats.md`；`docs/api/110-api-manuscript.md`「码字统计」。

**改动范围**：

1. `packages/db/src/tables.ts`：新增 drizzle `writingStatsDaily`（`statDate` 主键 / `chars` / `updatedAt`；检查 `chars > 0`）与同形 `CREATE_TABLES_SQL` 条目。
2. `packages/db/src/schema.ts`：`SCHEMA_VERSION` 13 → 14。
3. `packages/db/src/migrations/014_writing_stats.ts`：纯 DDL、幂等、列序与 `CREATE_TABLES_SQL` 同形；`packages/db/src/migrations/index.ts` 注册 014 并更新版本注释。
4. `packages/db/src/queries/writing-stats.ts`：唯一写入入口 `addWritingChars(db, date, chars, now)`（只接受正整数，upsert `chars = chars + excluded.chars`）与读取 `listWritingStats(db)`（按 `stat_date` 升序）；经 `queryDb`，不绕过 drizzle；`packages/db/src/index.ts` 导出。
5. `packages/shared/src/types/api.ts`：`writingStatsResSchema` + `WritingStatsRes`（字段严格按 API 文档，`days` 只含正数日）。
6. `packages/server/src/local-date.ts`（或同层等价单文件）：`localDateKey(date = new Date())` 用本地 `getFullYear/getMonth/getDate` 补零，**禁止 `toISOString().slice`**（UTC 会跨日）；写/读共用这一处。
7. `packages/server/src/routes/writing-stats.ts`：`GET /` → `requireCurrentProject` → 读行集 → `{ today, totalChars, totalDays, days }`；`packages/server/src/index.ts` 在章正文组旁挂 `app.use("/api/v1/writing-stats/*", requireKind("novel"))` + `app.route`。
8. `packages/server/src/routes/manuscript.ts`：PUT 在 `existing` 已在手后计算 `delta = contentText.length - (existing?.content_text.length ?? 0)`；仅 `delta > 0` 时调 `addWritingChars(project.db, localDateKey(), delta, updatedAt)`；**统计写失败 try/catch + `console.error("[stats] ...")`，不回滚正文、不改变 PUT 响应**。不新增请求字段、不动版本戳/Delta/current_position 语义。
9. 同步所有硬编码旧版本的测试断言（`002_event_timeline.test.ts`、`003_timepoint.test.ts`、`007_character_ability_panel.test.ts`、`009_decompose.test.ts`、`010_decompose_concurrency.test.ts`、`013_author_practice.test.ts`、`migrations/index.test.ts`），新增 `014_writing_stats.test.ts`（空库应用、幂等、旧库升级、`table_info`/索引对齐）与 `schema.test.ts` 对齐断言。

**必须补的测试**：

- `addWritingChars`：同日累加、跨日分行、只接受正数、`chars > 0` 约束；`listWritingStats` 升序。
- `GET /writing-stats`：空库（0 / 0 / `[]`、`today` 格式）、两日累计、练习工作区 400 `KIND_MISMATCH`（加进 `kind-guard.test.ts` 的探测表）、无项目 409。
- `PUT /manuscript`：首次保存计入、同章再增长按差值计入、缩短/清空**不扣减**、覆盖保存（无 `base_updated_at`）按净正差计入、统计写入抛错时 PUT 仍 200（mock/spy 该 helper）。
- `localDateKey`：本地 00:00 前后、跨月/跨年边界（用本地 `new Date(y,m,d,...)` 构造，不依赖运行机时区）。

**验收判据（硬）**：

- 新 commit（`feat(stats): ...`）+ `git status` 干净；汇报必须附 commit hash 与下列命令输出。
- `pnpm -r build` → `pnpm typecheck` → `pnpm lint`。
- `pnpm --filter @whispering233/ai-editor-db test`、`pnpm --filter @whispering233/ai-editor-server test`、`pnpm --filter @whispering233/ai-editor-shared test` 全绿（过滤名逐字一致）。
- 不改 client/desktop；不新增依赖。

### stats-2-page — 「码字统计」页面与导航

**依赖**：`stats-1-backend`（shared 类型 / `GET /writing-stats`）。

**契约**：`docs/ui/DESIGN.md`「码字统计页」；`docs/api/130-api-writing-stats.md`。

**改动范围**：

1. 导航：`packages/client/src/components/nav/nav-items.tsx` 的 novel 项集在「参考资料」后加 `{ key: "/stats", label: "码字统计", icon: BarChartOutlined }`；`nav-items.test.ts` 的精确数组断言改为九项（practice 五项不变）。
2. 路由：`packages/client/src/hooks/use-route.ts` 的 `KNOWN_ROUTE_SEGMENTS` 加 `"stats"`；`packages/client/src/main.tsx` 加 `case "stats"`；`packages/client/src/lib/workspace-route-guard.test.ts` 补「练习工作区 `/stats` 被挡回 `/practice`」。
3. API：`packages/client/src/lib/api.ts` 加 `getWritingStats(): Promise<WritingStatsRes>`（GET，复用公共请求封装与错误映射）。
4. 纯函数：新建 `packages/client/src/lib/writing-stats.ts`——日期键与月矩阵（不引 dayjs；用本地 `Date(y,m,d)` + 纯字符串键）、近 N 天窗口、近 12 个月聚合、区间合计/日均/最高、`WRITING_HEAT_LEVELS`（0 + 4 正档的阈值/取档单一定义）与格式化（千分位、`HH:MM:SS` 不需要）。**所有阈值只在 constants 区出现一次**，组件不手写数字。
5. 组件：新建 `packages/client/src/components/stats/month-calendar.tsx`（7 列月历 + 翻月 + 今天 + 选日 + 月汇总）、`year-heatmap.tsx`（53×7 热力 + 图例 + 点选）、`daily-bars.tsx`（7/15/30/月柱状 + 原生 `title`），复用 `SectionCard` / `PageHeader` / token；不新增 CSS 文件、不写内联色值、不写任意字号。
6. 页面：新建 `packages/client/src/pages/WritingStats.tsx`——页头常驻模板、四摘要、宽栏「月历 320 + 趋势」/窄栏堆叠、年度热力全宽；加载 `Skeleton`、错误 `Alert` + 重试、空态 `EmptyState`；只发一次 `GET /writing-stats`，月/年派生在客户端。
7. 测试：`lib/writing-stats.test.ts`（闰年 2 月、跨年翻月、月矩阵首日对齐、近 N 天、月聚合、热力档位边界、合计/日均/最高）；`month-calendar.test.tsx` / `year-heatmap.test.tsx` 用 `react-dom/server` 的 `renderToString` 断言可见文本与 `title`（不引 jsdom / testing-library）；页面 SSR 至少断言页头标题与加载骨架。

**验收判据（硬）**：

- 新 commit（`feat(stats): ...`）+ `git status` 干净；汇报附 hash + 命令输出。
- `pnpm -r build` → `pnpm typecheck` → `pnpm lint`；`pnpm --filter @whispering233/ai-editor-client test` 全绿。
- 不新增依赖（尤其 **不引 dayjs / 图表库 / antd Calendar / DatePicker**）；不改 client 以外包。
- `subagent("ui-verifier")` 独立验收，截图/交互样本 **≤ 8 个**：宽/窄中栏、浅/深色、有数据/空数据、月历选日、年热力点选跳月；报告附像素结论与越界/对比度问题。

### stats-3-hud — 当日码字悬浮面板

**依赖**：无（可与 `stats-1-backend` 并行；不依赖后端）。

**契约**：`docs/ui/DESIGN.md`「当日码字悬浮面板」；`docs/design/config.md` 的 `ai-editor:stats-panel`。

**改动范围**：

1. 纯逻辑：新建 `packages/client/src/lib/writing-session.ts`——`TYPING_ACTIVE_GAP_MS` / `MIN_RATE_WINDOW_MS` 常量、`applyActivity(state, delta, now)`（只加正增量；间隔 ≤ 阈值累加码字时间；更新最后变更时刻）、`displayTypingMs(state, now)`（仅把未超阈值的尾段计入显示）、`formatRate` / `formatDuration`（`—` / `HH:MM:SS`）；单测覆盖删除负增量、空闲超阈值、精确边界、速率窗口过短。
2. Store：新建 `packages/client/src/stores/writing-session.ts`（zustand）——`{ projectId, chars, typingMs, lastEditAt, visible, dismissed, hasAutoOpened }`；`recordDelta(projectId, delta, now)` 在项目变化时先归零；`open/close/dismiss`；**不落 localStorage / 不发请求**。
3. 编辑器：`packages/client/src/components/blocknote/document-editor.tsx` 加可选 `onTextDelta?: (delta: number) => void`——挂载时用 `initialContent` 经 `parseBlockContent` + shared `blocksToPlainMd` 取基线，首次 onChange 起算 `newLen - lastLen`；**仅在传入时计算**（参考资料编辑器不受影响）。`Manuscript.tsx` 传 `onTextDelta`，并把当前项目 id 交给 store。
4. 外壳：`packages/client/src/components/main-panel/MainPanel.tsx` 挂 `StatsHud`（绝对定位、`<main>` 直接子元素；不能进滚动区）；新增 `packages/client/src/components/stats/stats-hud.tsx` + `packages/client/src/lib/stats-hud.ts`（位置读写、`clamp` 到中栏矩形、坏值回落；key = `ai-editor:stats-panel`）。
5. 位置/拖动：pointer capture；窗口/中栏 `ResizeObserver` 后重新 clamp；入口 `FloatButton` 固定在 AI 上方（`bottom:72`、`zIndex:20`），面板打开时隐藏；X 关闭后面板隐藏、入口回来，`dismissed=true` 使本次运行不再自动弹（换书归零）；面板初始 `right:16 / bottom:72`、宽 240、浮层阴影。
6. 显示：2×2 指标、`HH:MM:SS`、千分位、速率窗口过短显示 `—`；空闲时间秒级刷新（仅面板可见时跑 interval，卸载清理）；专注模式/练习/无项目不渲染但追踪器继续；**页面「今日」与面板「本次」标题区分**。
7. 测试：`lib/writing-session.test.ts`、`lib/stats-hud.test.ts`（clamp / parse / 越界 / 坏 JSON）；store 测试（换书归零、关闭后不自动弹、重开显示累计、负增量不扣）；`stats-hud.tsx` SSR（标题与四项标签）；**不引入 jsdom/testing-library**。

**验收判据（硬）**：

- 新 commit（`feat(stats): ...`）+ `git status` 干净；汇报附 hash + 命令输出。
- `pnpm -r build` → `pnpm typecheck` → `pnpm lint`；`pnpm --filter @whispering233/ai-editor-client test` 全绿。
- 不新增依赖；不改 server/db（本项目只在前端）。
- `subagent("ui-verifier")` 独立验收，样本 **≤ 6 个**：面板在 AI 上方、拖动不越中栏、关闭/重开、跨章保留、换书归零、专注模式隐藏；报告附位置/遮挡/像素结论。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。