# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 执行顺序与并行

卡 1 →（卡 2 ∥ 卡 3）→ 卡 4。卡 2 与卡 3 文件面不重叠，可并行（临时分支 + git worktree，验证后合回 main）；卡 1 先行（卡 3 的实测与卡 2 的真跑都应在卡 1 语义下落定）；卡 2 与卡 4 同文件面，串行。

---

## 卡 1 · S2 端点校验后移（关系端点判据唯一化）

**契约**：`60-decompose.md` §4.1（关系端点判据唯一在 S3）/ §6 第 1 层第 4 步 / §9 不变式 13。

**范围**

- `packages/server/src/decompose/extract.ts`：`normalizeExtraction` 去掉「端点不在已知名字集合 ⇒ 丢弃」；白名单 / 字段 / 长度 / 条数判据不变；`discarded` 原因文案随动。
- `knownNames` 参数若因此无消费者 → 一并移除；`runner.ts` 里供提示词渲染的裁剪名字集合**不受影响**（它服务 prompt，不服务校验）。
- 测试：`extract.test.ts` 端点用例改为「端点未知不再丢弃」；`runner.test.ts` 相关断言同步。

**硬完成判据**：`pnpm --filter @whispering233/ai-editor-server test` 全绿 + `pnpm typecheck` + `pnpm lint`；`git log` 含本卡新 commit、`git status` 干净；汇报必附 commit hash 与命令输出。

**验证**：oracle 独立复核（反例：真幻觉端点确实由 S3 悬空过滤拦下）。

---

## 卡 2 · 分段并发（S2 主改造）

**契约**：`60-decompose.md` §2.1 / §2.2 / §4 / §4.1 / §7 / §7.2 / §8；`docs/db/schema.md`（`decompose_jobs.concurrency`）；`docs/api/120-api-decompose.md`（pause / resume / job log）。

**范围**

- **db**：迁移 `010_decompose_concurrency.ts`（`decompose_jobs` 加 `concurrency INTEGER NOT NULL DEFAULT 1`，纯 DDL）+ `tables.ts` 声明 DDL + `createDecomposeJob` 入参与行映射 + 测试。
- **配置读取**：创作根 `.ai-editor/config.json` 的 `decompose.concurrency`——缺省 / 钳制常量单点（`DEFAULT_DECOMPOSE_CONCURRENCY` / `MAX_DECOMPOSE_CONCURRENCY`）；文件不存在 / 非法 JSON / 结构不符 / 值非法 → 缺省（与 `debug.ts` 同款容错；不重构现有两处读取）。
- **batching**：新增纯函数 `planSegments(batches, concurrency)`——沿批边界按累计字数均衡、段数 = min(并发数, 批数)。
- **llm**：worker 会话组装——主 `decompose-<jobId>`、worker `decompose-<jobId>-w<k>`（同一清洗函数；会话名 `《书名》拆解 · 段 k/N`）；`openDecomposeSession` 支持段。
- **runner**：`executeRun` 改「段间并行、段内串行」，每段独立滚动累积（起始快照同源）；暂停 / 切书 / 中止 = 每段当前批跑完即停（在途 ≤ N）；resume / 单批重跑按 job 快照重算段、按段内已完成批重建累积；429 / 限流指数退避 + 抖动；`pruneDecomposeSessions` 按 job 删主 + worker（worker 用 `decompose-<jobId>-w` 前缀命中 pi 磁盘发现）。
- **job**：建 job（首拆 / 续拆）读取并发并快照。
- **routes**：`GET /decompose/job/log` 合并主 + worker 会话（按时间排序；响应形状不变；`batch_start` 带段号）。
- **提示词对齐**：批提示词里「source / target 必须是本章或上文出现过的名字」的措辞要与 §4.1「跨段一致性交 S3」对齐——分段并发下「上文」只含本段，避免该措辞阻止模型产出跨段关系（落库判据仍只在 S3，S2 不预丢）。
- **测试**：batching（段划分边界）、runner（段累积 / 暂停 / 续拆 / 重跑 / 清理）、db（迁移 + 行映射）、routes（log 合并）。

**风险**：pi N 会话的进程内并发安全（真跑冒烟证明）；数据库写并发（单连接 + JS 单线程，需用例覆盖）。

**硬完成判据**：上面三命令全绿 + 样本书（`references/` 25 万字本）真跑一次（并发 N = 4）：job `done`、零失败批、墙钟记录在案；commit + 命令输出。

**验证**：oracle 独立复核；真跑对照（串行 1 / 并发 N 的墙钟与产物差异——结构化对照见卡 3 的串行档）。

---

## 卡 3 · 批大小实测（dev-only harness）

**契约**：`60-decompose.md` §4（组批）；结论回写该节与常量注释。

**范围**

- 新增 dev-only harness（`scripts/`，不入 `src`）：读 `references/` 样本书 → `split.ts` 切章 → 按指定 target `planBatches` → 逐批经 `llm.ts`（同一 Agent 路径 / 同一模型）→ 收集结果。
- 四档：**当前值 / 2× / 4× / 全文一批**（数值由 harness 参数给出，不复刻常量）。
- 产出：各档逐章摘要 / 实体 / 关系对照、失败与截断计数、墙钟、token 用量；人工盲评材料（打乱档位的章摘要抽样）。工件落 `references/decompose-batch-experiment/`（不入库）。
- 结论（仅口径，不含历史叙事）回写 `60-decompose.md` 批大小口径与常量处注释。

**硬完成判据**：四档跑完、产出齐全；「保持 / 上调」判定与依据已回写文档；commit + 命令输出。

**验证**：orchestrator 汇总 + 用户人工盲评。

---

## 卡 4 · 批大小双向守卫（卡 2 合入后做）

**契约**：`60-decompose.md` §4（组批 / 并发）。

**范围**

- 组批时按 `Model.contextWindow` / `Model.maxTokens`（pi 已暴露，经 `getModelRuntime()` 取）做双向预检：
  - 输入侧：批估算输入（正文 + 系统 + 快照）≤ 窗口 − 输出预留 − 安全余量；超限自动拆批（章为最小单位）。
  - 输出侧：估算输出（章数 × 每章预算）≤ `maxTokens` 预留；超限自动减少批内章数。
  - 单章本身超限 → 该批显式失败 + 明确错误文案（不再落进 pi `clampMaxTokensToContext` 压输出 → provider 报错的路径）。
- 估算常量复用现有（`DECOMPOSE_CHARS_PER_TOKEN` / 每章输出预算）；若卡 3 结论已回写则同步校准。
- 测试：预算边界 / 自动拆批 / 单章超长错误文案。

**硬完成判据**：命令同卡 1；错误路径有单测；commit + 命令输出。

**验证**：oracle 独立复核。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
