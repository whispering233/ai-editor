# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 作家文风练习改版（2026-10）— 进行中

**契约**：`docs/design/60-practice.md`（设计）、`docs/api/120-api-practice.md`（端点）、`docs/db/schema.md`「练习三表」与「project.json」（字段）、`docs/ui/DESIGN.md`「作家文风练习区」/「根首页」/「导航与外壳」（视觉）、`docs/api/tool-calling.md`（工具面）、`docs/api/80-api-chat.md`（注入）。

**链内红窗（有意，已登记）**：这是同一功能的**模型重建**——旧常量、旧端点（`/practice/targets*`）与旧练习表被删，消费方在后续卡里跟上。**中间卡允许全仓 `pnpm typecheck` 变红**；每卡判据 = **本包 build + 本包测试 + 本卡改动范围**；全仓 `typecheck` / `lint` / `pnpm -r test` 由**卡 8 收口**。

**卡序重切（2026-10，文件冲突驱动的调整）**：原 3–6 拆分会让多张卡同时写 `shared/types/api.ts`、`server/routes/practice.ts`、`client/lib/api.ts`（同一批文件），worktree 并行反而要人工解冲突 ⇒ 收成「一张端点卡 + 三张客户端卡」并改为顺序推进（**不并行 worktree**）。已完成并通过独立验证的卡：卡 1（`6955d833`）、卡 2（`387f72f5`，含偏离裁定：`012_practice.ts` 不再建旧索引，口径已落 `docs/db/schema.md`）、卡 3（`163095d2`，含裁定 A：chat 样本侧注入本卡改完；被删的 details 用例归卡 7 恢复）、卡 4（`38d4654d`，P2 打磨归卡 8）、卡 5（`738cf28b` + 修复 `09d5a895`：oracle 判 FAIL 的「可点评判定重复实现」已单源化，复核接受；P2 归卡 8）。

**每卡硬完成判据（缺一不可，汇报必附原始输出）**：
1. `git log --oneline -1` 含**本卡的新 commit**（无 commit 不许报 PASS），`git status --porcelain` 干净；
2. 本卡「验收命令」全绿（命令与输出摘要一并附上）；
3. 汇报写明改动的文件清单 + 与卡内任一条不对应的实现说明（如有）。

**环境备注（2026-10，影响 server 测试判据）**：端口 `3500` 被一个**外部先占进程**（`node packages/server/dist/index.js test-project`）占用 ⇒ `packages/server/src/index.test.ts` 的「端口策略」用例会 `EADDRINUSE` 超时。该用例与练习改版无关：server 判据 = **除该用例外全绿 + 附占用证据（进程 cmdline / 监听端口命令输出）**；若该进程已停，完整全绿。

---

### 卡 6：客户端 C — 根首页分区 + 左栏五项 + 路由守卫 + 三素材页

**改动范围**：`packages/client/src/pages/Dashboard.tsx`、`packages/client/src/stores/project.ts`、`packages/client/src/lib/workspace.ts`、`packages/client/src/components/nav/nav-items.tsx`、`packages/client/src/main.tsx`、`packages/client/src/hooks/use-route.ts`、`packages/client/src/lib/workspace-route-guard.ts`、`packages/client/src/pages/AuthorIntro.tsx`（新建）、`packages/client/src/pages/Works.tsx`（新建）、`packages/client/src/pages/StyleNotes.tsx`（新建，若卡 3 未建）+ 各自测试。

**实现**（契约 = `DESIGN.md`「根首页」「导航与外壳」「作家介绍 / 作品介绍 / 作家风格说明」、`60-practice.md` §9）：
1. 根首页练习分区：**预置作家卡**（全部预置作者；名字 + 一行介绍摘录 + 状态行 [未开始 / `N 篇范文 · 最近更新 …`]；排序 = 有数据 `updatedAt` 倒序在前、未开始按清单顺序垫后）；未识别 `authorId` 的练习项**不列出**（客户端过滤，服务端照列）；点未开始卡 = 懒创建（`name` = 作家名 + `author_id` + `kind: "practice"`，落 `#/practice`）；点已有卡 = 打开；**删「新建练习区」入口**。
2. 左栏练习态五项（作家介绍 `#/author` / 作品介绍 `#/works` / 作家风格说明 `#/style` / 文风练习 `#/practice` / 自由练习 `#/free`；图标走 `@ant-design/icons`）；路由注册五页 + `#/practice/:sampleId` / `#/free/:pieceId`。
3. 守卫：**练习专属首段清单单一定义**（上述五段）；练习工作区按允许清单放行（+ `#/` + `preferences`），小说工作区挡任一段 → `#/`；落点仍是 `#/practice`。
4. 三素材页：作家介绍（markdown 只读 `card`）、作品介绍（每部作品一卡）、作家风格说明（渲染 + 编辑 + 导入 `.md` + 恢复预置；导入 / 恢复走 danger 确认框；有覆盖时一行「当前为自定义版本」），编辑态 `TextArea` + 保存失败 `return false` 阻断存档。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-client test`。

**Commit**：`feat(practice): 根首页预置作家卡、左栏五项与素材三页`

---

### 卡 7：AI 工具面与内核提示词改版

**改动范围**：`packages/agent/src/runtime/system-prompt.ts`（**只重写 `PRACTICE_KERNEL_PROMPT`**）+ `system-prompt.test.ts`、`packages/tools/src/schemas/practice.ts` / `query/practice.ts` / `registry.ts` + 测试、`packages/shared/src/constants/tool.ts`（`TOOL_DETAILS_TO_CLIENT`）+ `constants.test.ts`、`packages/server/src/routes/chat.ts`（`context.practice_free_piece_id` + 注入展开）+ `chat.test.ts`、`packages/agent/src/runtime/{tools,project-runtime}.test.ts` 相关断言。

**实现**（契约 = `tool-calling.md` 练习段、`60-practice.md` §7 / §8、`80-api-chat.md`）：
1. 七件工具（四只读 + 三写 AI 产出），全部 `scope: "practice"`；点评工具 dimensions 上限与出题工具 topic / brief 上限**由常量插值**进描述。
2. 引用校验：仿写 = 范文 `或` 稿件子串；自由练习 = 风格说明（用户覆盖 `??` 预置）`或` 稿件子串；不匹配丢弃并计 `dropped_quotes`；空串 / 纯空白同路径。
3. `submit_practice_topic`：题目非空 → 抛错拒写。
4. 三个写工具的 `details` 进 `TOOL_DETAILS_TO_CLIENT`。
5. chat 注入：`practice_free_piece_id` 分支（篇 id + 作家名 + 题目 + 写作要求；不存在 → 静默省略；**样本侧注入已在卡 3 改完，本卡不动**）。
6. `PRACTICE_KERNEL_PROMPT` 重写（仿写点评者 + 自由练习点评者 + 出题者；保留不代写 / 引用须逐字 / 先读后评 / 维度自定 / 长度截断须知；新增「出题要给可执行的写作要求」；仿写以范文为主、可按需读风格说明）。
7. **硬判据（oracle 独立核）**：小说版 `KERNEL_PROMPT` **零 diff**；小说工具 schema/description 与小说注入分支无改动。
8. **恢复被删的用例（卡 3 交出）**：`packages/server/src/routes/chat.test.ts` 里原「点评一轮：提交工具 details 随帧下发 + 落库」用例在卡 3 被删并留注释指向本卡——**本卡必须恢复它**（适配新工具名：`submit_style_feedback` / `submit_free_feedback` / `submit_practice_topic`，以及 `TOOL_DETAILS_TO_CLIENT` 白名单），否则该注释即悬空引用。

**验收命令**：`pnpm -r build` → `pnpm --filter @whispering233/ai-editor-tools test` → `pnpm --filter @whispering233/ai-editor-agent test` → `pnpm --filter @whispering233/ai-editor-server test`。

**Commit**：`feat(practice): AI 工具面与内核提示词改版（自由练习点评 / 出题）`

---

### 卡 8：全链路收口与验证

**改动范围**：缺陷修复（仅限改版链路内的真实缺陷）、`docs/design/tasks.md` 清卡、`CHANGELOG.md` 校对。**不新增功能**。

**实现**：
1. `pnpm -r build` → `pnpm typecheck` → `pnpm lint` → `pnpm -r test` **全绿**（红窗在此关闭；端口 `3500` 若仍被外部进程占用，按顶部环境备注判据）；把命令与输出摘要写进汇报。
2. 逐条核对实现 ↔ 文档（`60-practice.md` / `120-api-practice.md` / `schema.md` / `DESIGN.md`），发现漂移就地修并在汇报中列出。
3. **补测试覆盖（卡 2 oracle 的 P2-2 / P2-3）**：在 `packages/db/src/migrations/013_author_practice.test.ts` 的 v12 fixture 里显式造出将被 013 删除的旧索引，迁移前断言存在、迁移后断言为空（否则 `DROP INDEX IF EXISTS` 只走 no-op 分支）；并把该测试里「三表只断言 `columns.length > 0`」补成显式列名断言。
4. **收口卡 3 oracle 的 P2（全部为本卡范围内的最小修）**：
   - `packages/shared/src/types/api.test.ts`：`"d".repeat(20001)` 改为用 `MAX_PRACTICE_DRAFT_CHARS + 1`（数值单源）；该文件里「包含全部 10 个现行错误码」标题去掉数字（实际已 13 条）。
   - `packages/server/src/routes/practice.test.ts`：`expect([400,409]).not.toContain(res.status)`（新增的守卫用例）改为能拒 500 的断言（如 `expect(res.status).toBeLessThan(500)` 或按端点断言期望状态集）。
   - **空白文本口径**：`excerpt_label` / `brief` 入库前 `trim`（shared schema 加 `.trim()`；同时把 server 侧断言「`" 节选 "` 原样存」改为存 trim 后的值），避免纯空白片段说明 / 写作要求在注入里产生空内容行（`chat.ts` 的 `!== ""` 判据由此变实）；改完同步检查 `120-api-practice.md` 是否需补一句「两端点字段写入前 trim」。
5. **打磨卡 4 oracle 的 P2（均为一行到数行的小修）**：
   - `create-sample-dialog.tsx`：`excerptLabelError` 是**写不进去的死状态**（全文件只置 `null`）——要么删该 state 与分支，要么补一条真正可达的校验；
   - `Practice.tsx`：组内「新建样本」要随 `author === null` 一起 `disabled`（与页头按钮同口径，否则作家未解析时组内按钮可点、创建被服务端 400 拒）；
   - 导入成功路径**只在字段为空时**预填片段说明（不静默覆盖用户已输入的说明）；
   - 列表重拉时**仅首帧**置 `null`（后续保留旧列表，避免提案确认后整页骨架闪）；
   - 补一条 SSR 断言：默认「其他」真被 `Select` 选中 / 组内按钮把该组 `workId` 传入对话框（卡 4 oracle 的弱断言项）。
6. **打磨卡 5 oracle 的 P2**：`lib/free-practice.ts` 的 `topic` 非字符串时抛 `TypeError`（服务端 shape 漂移才可达）——加 `typeof` 守卫；`pages/free-detail.test.tsx` 的用例名「输入框有未保存改动」与断言不符（实际只传 `canReview:false`）——改名或补真实场景；**补缺口**：容器路径（「让 AI 出题」链路 / 新建题目提交 / `PRACTICE_NOT_FOUND` → 404 态）与 `FreeDetail.tsx` 的 `canReview` 接线各最少一条测试。
7. **浏览器像素走查委托 `ui-verifier`**（核验项：根首页练习分区预置卡与懒创建 / 左栏五项 / 风格说明渲染与编辑 / 文风练习分组列表与新建样本（含导入文件）/ 自由练习出题与点评 / 详情页排版）；发现问题回到对应卡修完再复验。
8. 清空本批卡片；确认 `CHANGELOG.md` Unreleased 段与最终实现一致（含迁移 013 说明）。

**验收命令**：上列四条 + ui-verifier 报告（无未 proven 项）。

**Commit**：`chore(practice): 改版收口（全量回归与文档对齐）`

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。