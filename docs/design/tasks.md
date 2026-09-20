# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 拆解会话与续拆（2026-09）

契约依据：`docs/design/60-decompose.md`（§2.1 会话形态 / §4.1 快照 / §6.1 跨轮 / §7.1 续拆 / §7.2 上限 / §8 时间线 / §9 不变式）、`docs/api/120-api-decompose.md`、`docs/api/80-api-chat.md`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（会话右栏 / 拆解小说）。**卡序 = 依赖序**：22.1 → 22.2 → 22.3 → 22.4 → 22.5 → 22.6 → （22.7 + 22.8 同批）。

### 卡 22.1 · server：LLM 走 pi 的源码扫描守卫

- **范围**：`packages/server/src` 新增源码扫描测试：除 `decompose/llm.ts` 外不得出现 `completeSimple` / 直连 pi stream 入口 / provider host 字样 / 自建 `Authorization`・`x-api-key` 头。
- **完成判据**：先故意加一行反例 → 测试报红（含文件名与指向 `llm.ts` 的提示）；移除后转绿。不涉及行为改动。

### 卡 22.2 · server：拆解会话落盘 + chat 侧服务端守卫

- **范围**：① `decompose/llm.ts` 改 `SessionManager.create(cwd, <项目根>/sessions, { id: "decompose-" + 清洗后 jobId })`（清洗纯函数写读共用）、每 turn 前 `resetLeaf()`、建会话后 `setAutoCompactionEnabled(false)` + `appendSessionInfo("《书名》拆解")`；② runner 过程条目 `appendCustomEntry("decompose", …)`（批开始 / 每次尝试失败（时间 + 原因）/ 批完成（计数 + 用量）/ 归并 / 报告 / 快照组成）；③ `POST /chat` 拒 `decompose-*`（409 `SESSION_READONLY`）；`DELETE /chat/sessions/:id` 对该前缀查 job 是否在跑，在跑 → 409 `DECOMPOSE_JOB_RUNNING`。
- **完成判据**：单测证「两轮 prompt 后文件里是两条独立根（`parentId: null`）、第二轮请求体不含第一轮内容」（faux provider 捕获请求）+ 文件落在 `sessions/` + 两个守卫生效；真跑一本小书人工核对文件里能看到原文批与 JSON 产出。

### 卡 22.3 · client：chat 面板拆解会话只读态

- **范围**：`GET /chat/sessions` 回传 `name`（shared schema 同步）；列表项显示会话名 + 「拆解」徽标；选中拆解会话时**不渲染输入框**、顶部只读说明行；删除保留（danger + 二次确认，文案注明不影响拆解数据）、在跑时禁用。
- **完成判据**：浏览器核对（列表可辨、发送入口不存在、可滚看全过程、删除确认）；client 单测覆盖 `decompose-` 前缀分支。

### 卡 22.4 · server+client：拆解记录时间线

- **范围**：`GET /api/v1/decompose/job/log`（读会话 custom 条目，服务端渲染单行文案与 `kind`）；`#/decompose` 折叠时间线区（`data-row` 行 + 空态）；会话被删 → 空数组、不回 404。
- **完成判据**：契约测试（含「只记批表没有的信息」） + 页面像素核对。

### 卡 22.5 · server：项目数据快照（设计 §4.1）

- **范围**：起始快照读库（人物带 `role` 排序 / 关系 / 新范围前 `DECOMPOSE_SNAPSHOT_PREV_CHAPTERS` 章摘要）+ 本轮累积；预算 `DECOMPOSE_SNAPSHOT_MAX_CHARS`；丢弃顺序（设定/地点名 → 关系 → 前置摘要 → 人物名）+ **显式告知**；`knownNames` 用未裁剪全集。
- **完成判据**：单测覆盖超预算时的丢弃顺序与告知文案；单测证「名字渲染被截断时，关系端点仍不被当幻觉丢弃」。

### 卡 22.6 · server：跨轮写入口径（设计 §6.1）

- **范围**：baseline = 历史全部 job 的 `merge_written` 并集（同 id 取最新时间戳）；库内同名实体/关系**复用同一行**（不重复建）；跨轮未重现**不软删**；报告跨轮更新同一条；增量更新口径（`description` 取更长者 / `personality` 并集 / `role` 非空则更新 / gender・age・race・alias 仅补空 / 别名段合并）；无变化不写。
- **完成判据**：单测造两个 job（第二轮范围不与第一轮重叠）——实体/关系数量不增（复用）、无 `RELATION_EXISTS` 报错、第一轮产物未被软删、报告仍只一条、用户改过的行不被覆盖。

### 卡 22.7 · server+client：续拆（设计 §7.1）

- **范围**：`GET /decompose/plan`（缺省 = 未拆章最小覆盖区间、`decomposed` 标注、预估复用 analyze 实现、404 `DECOMPOSE_NO_CHAPTERS`）；`POST /decompose/continue`（S1' 只落 job + 批规划，400 `DECOMPOSE_NOTHING_TO_DO` / 409 `DECOMPOSE_JOB_STATE` / 400 `LLM_API_KEY_MISSING`）；完成态「继续拆解」按钮 + 范围对话框（复用预览段、跳过选文件）。
- **完成判据**：端到端（拆全量的一小段 → 续拆剩余 → 库内实体不重复、报告仍一条）；无未拆章时按钮禁用；running/paused 时 `continue` 返 409。

### 卡 22.8 · server：拆解会话保留上限（与 22.7 同批，设计 §7.2）

- **范围**：`DECOMPOSE_KEPT_SESSIONS`（server 拆解模块常量）；新一轮建会话前按 job `created_at` 保留最近若干枚、只删 `decompose-` 前缀且 job 不在跑；清理写日志 + 往新会话追加一条过程条目；失败不阻塞。
- **完成判据**：单测造 6 轮 job → `sessions/` 下只剩 5 枚 `decompose-`，chat 会话不受影响，最新一轮会话里有「已清理」过程条目。

---

## 卡的分工与验收

- **派工与验收命令**：见根 `AGENTS.md`「协作流程」（子代理 `context: "fresh"`、硬完成判据、`pnpm typecheck` / `lint` / `-r test`、单包 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（`gh auth status` → CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
