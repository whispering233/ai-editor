# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## D1 — 推演节点标记契约与纯函数（无 UI）

- **依赖**：无（其余三卡的根）
- **契约**：`docs/db/schema.md`（project.json `deduction_nodes`）、`docs/api/10-api-project.md`（GET/PUT `/config`）、`docs/design/10-data-model.md` §15
- **改动范围**：`packages/shared/src/{types/project.ts,types/api.ts,utils/mapping.ts,utils/deduction.ts(新),index.ts}`、`packages/client/src/lib/outline-tree.ts`、`packages/server/src/routes/project.ts`
- [ ] shared 类型/schema：`ProjectConfig.deductionNodes`、`ProjectFileConfig.deduction_nodes?`、`projectConfigSchema`、`projectConfigUpdateReqSchema`、`chatSendReqSchema.context.focus_deduction`；`mapProjectFileToConfig` 缺字段兜底空数组
- [ ] shared 纯函数：`orderVisibleChapters(tree)`（可见章先序 id，唯一编号口径）+ `buildDeductionMarks(tree, ids)`（过滤失效/非章 → 树序排序 → 去重 → 角色 `single|start|node|end` + 徽标文案 + 章号）
- [ ] client：`numberOutline` 改为消费 shared 纯函数（既有测试断言不得改）
- [ ] server：`PUT /config` 处理 `deduction_nodes`（全量替换 + 去重 + 树序归一；逐 id 校验：不存在/已软删 → 400 `OUTLINE_NODE_NOT_FOUND`，非章 → 400 `VALIDATION_ERROR`）
- [ ] 测试：shared 纯函数（单/多标记文案、软删后编号重排、失效 id 过滤、去重）；server 路由（成功 / 两类 400 / `[]` 清空 / 省略不动 / 旧文件缺字段 → GET 返回 `[]`）
- **完成判据**：新 commit + `git status` 干净；`pnpm -r build && pnpm typecheck && pnpm lint && pnpm -r test` 全绿；汇报附 commit hash 与命令输出

## D2 — 大纲页标记 UI（徽标 + 入口）

- **依赖**：D1
- **契约**：`docs/ui/DESIGN.md`（`推演节点` 徽标 / 大纲页双视图 / `data-row`）、`docs/design/10-data-model.md` §15
- **改动范围**：`packages/client/src/lib/deduction.ts(新)`、`pages/Outline.tsx`、`components/outline/chapter-view.tsx`、`pages/OutlineDetail.tsx`
- [ ] `lib/deduction.ts`：切换提交（全量数组 + 一次 `updateConfig`）+ toast，形态对齐 `lib/current-position.ts`
- [ ] 树视图：章行行尾徽标（排在「阅读进度」左侧）+ 右键菜单项（未标记 = `标记为推演节点`、已标记 = `移出推演节点`；**仅章行**）
- [ ] 章视图：行尾**只读**徽标（不引入按钮——「行内无操作按钮」收窄不变）
- [ ] 节点详情页：页头按钮（已标记 → `移出推演节点`）
- **完成判据**：同 D1 + **浏览器像素核对**（subagent 执行：三处徽标出现与位置、标记/移出后即时刷新、卷/场景行无入口）

## D4 — AI 查询工具 `get_deduction_marks`

- **依赖**：D1
- **契约**：`docs/api/tool-calling.md`「推演节点」
- **改动范围**：`packages/tools/src/{schemas/index.ts,query/deduction.ts(新),index.ts}`
- [ ] args schema（无参）+ `run` 返回 `{ marks, spans }`（区间含 `chapter_count` / `written_chapters` / 中间章清单）
- [ ] 注册（AUTO）+ description（推演语义与单/多标记口径；数值一律不手写）
- [ ] 测试：无标记 / 单标记 / 多标记 / 软删标记被过滤 / 区间章数与中间章
- **完成判据**：同 D1

## D3 — 注入链路（悬浮球 → focus 小条 → 服务端推演段）

- **依赖**：D1、D2（与 D2 同文件，必须串行）
- **契约**：`docs/api/80-api-chat.md`、`docs/design/20-context.md` §2、`docs/ui/DESIGN.md`（`focus-strip` / 悬浮球）
- **改动范围**：`packages/client/src/{lib/focus.ts,lib/api.ts,pages/Outline.tsx,pages/OutlineDetail.tsx,components/main-panel/MainPanel.tsx,components/chat/ChatPanel.tsx}`、`packages/server/src/routes/chat.ts`
- [ ] client：大纲组两页在**有标记**时上报 `currentFocus = { focus_deduction: true }`（依赖项目配置；配置加载完成后必须重跑，否则「有标记但按钮不带上下文」）；悬浮球 tooltip 分支；focus 小条文案「推演节点 · N 个」
- [ ] server：`buildFocusText` 推演段（口径说明 + 有序清单 + 区间摘要；无标记 / 全部失效 → 静默省略）
- [ ] 测试：server 注入段（有/无标记、软删过滤、单/多标记文案）；client `focusLabel` 推演分支
- **完成判据**：同 D1 + 一次真实点击链路核对（点击悬浮球 → 小条出现 → 提问命中推演节点上下文）

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
