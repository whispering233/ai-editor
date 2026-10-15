# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 作家文风练习改版（2026-10）— 进行中

**契约**：`docs/design/60-practice.md`（设计）、`docs/api/120-api-practice.md`（端点）、`docs/db/schema.md`「练习三表」与「project.json」（字段）、`docs/ui/DESIGN.md`「作家文风练习区」/「根首页」/「导航与外壳」（视觉）、`docs/api/tool-calling.md`（工具面）、`docs/api/80-api-chat.md`（注入）。

**链内红窗（有意，已登记）**：这是同一功能的**模型重建**——旧常量、旧端点（`/practice/targets*`）与旧练习表被删，消费方在后续卡里跟上。**中间卡允许全仓 `pnpm typecheck` 变红**；每卡判据 = **本包 build + 本包测试 + 本卡改动范围**；全仓 `typecheck` / `lint` / `pnpm -r test` 由**卡 8 收口**。

**卡序重切（2026-10，文件冲突驱动的调整）**：原 3–6 拆分会让多张卡同时写 `shared/types/api.ts`、`server/routes/practice.ts`、`client/lib/api.ts`（同一批文件），worktree 并行反而要人工解冲突 ⇒ 收成「一张端点卡 + 三张客户端卡」并改为顺序推进（**不并行 worktree**）。已完成并通过独立验证的卡：卡 1（`6955d833`）、卡 2（`387f72f5`，含偏离裁定：`012_practice.ts` 不再建旧索引，口径已落 `docs/db/schema.md`）、卡 3（`163095d2`，含裁定 A：chat 样本侧注入本卡改完；被删的 details 用例归卡 7 恢复）、卡 4（`38d4654d`）、卡 5（`738cf28b` + 修复 `09d5a895`：oracle 判 FAIL 的「可点评判定重复实现」已单源化，复核接受）、卡 6（`139f3509`）、卡 7（`934ffed8`，含恢复的 details 用例）。各卡 oracle 的 P2 打磨统一归卡 8。

**每卡硬完成判据（缺一不可，汇报必附原始输出）**：
1. `git log --oneline -1` 含**本卡的新 commit**（无 commit 不许报 PASS），`git status --porcelain` 干净；
2. 本卡「验收命令」全绿（命令与输出摘要一并附上）；
3. 汇报写明改动的文件清单 + 与卡内任一条不对应的实现说明（如有）。

**环境备注（2026-10，影响 server 测试判据）**：端口 `3500` 被一个**外部先占进程**（`node packages/server/dist/index.js test-project`）占用 ⇒ `packages/server/src/index.test.ts` 的「端口策略」用例会 `EADDRINUSE` 超时。该用例与练习改版无关：server 判据 = **除该用例外全绿 + 附占用证据（进程 cmdline / 监听端口命令输出）**；若该进程已停，完整全绿。

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
7. **打磨卡 6 oracle 的 P2（均为数行小修）**：
   - `Dashboard.tsx`：练习卡按钮 `disabled` 加 `|| bookshelf === null`（首帧书库未到时点击现在会静默 `return`，用户看不出为何没反应）；
   - 懒创建 catch 里对 409 `PROJECT_ALREADY_EXISTS` 兼底改为「直接打开该路径」（用户曾手建 `practice/<作家名>/` 时，现在会走进死路）；
   - 补强化几句**源码扫描式空断言**：`dashboard-partitions.test.ts` 的 `toContain("await loadBookshelf();")`（文件内多处命中，删任一处仍绿）、`not.toMatch(/kind === "novel"\s*\)/)`、`toContain("card.workspace === null")`，以及 `workspace.test.ts` 的「未开始按清单顺序垫后」（`AUTHOR_IDS.length === 1` 时恒真）——改为可证伪的断言或注明前提。
8. **卡 7 oracle 的 P2（文档精度 + 测试打磨）**：
   - `docs/api/tool-calling.md` 练习段三处精度：`submit_practice_topic` 的 details 补 `piece_id`（现写 `{ saved: true }`）；`get_free_draft` 补字段清单（`piece_id` 起头，无 `sample_id`/`work_name`/`excerpt_label`）；引用校验表述改为**字段分源**（`sample_quotes` ⊆ 依据；`draft_quotes` ⊆ 稿件）。
   - `packages/server/src/routes/chat.test.ts`：删或收窄恒真断言 `expect(userTexts).not.toContain("必须提交点评卡")`（该短语在注入与提示词里都不存在）；补自由练习侧「空串 / 纯空白引用丢弃」用例；`get_style_notes` / `get_free_draft` 各补一条截断（续读提示 + 拼回原文）用例；补 `submit_practice_topic` 描述里「题目已存在会失败」文案的断言（防静默漂移）。
9. **浏览器像素走查委托 `ui-verifier`**（核验项：根首页练习分区预置卡与懒创建 / 左栏五项 / 风格说明渲染与编辑（含确认框）/ 文风练习分组列表与新建样本（含导入文件）/ 自由练习出题与点评 / 详情页排版）；发现问题回到对应卡修完再复验。
10. 清空本批卡片；确认 `CHANGELOG.md` Unreleased 段与最终实现一致（含迁移 013 说明）。

**验收命令**：上列四条 + ui-verifier 报告（无未 proven 项）。

**Commit**：`chore(practice): 改版收口（全量回归与文档对齐）`

---

- **派工与验收命令、发布链路**：见根 `AGENTS.md`「协作流程」与 `build.md`「正式发布链路」——不在此重抄。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。