# 发布前复审纪要（S11.3）

> 任务卡 S11.3（doc/design/tasks.md）：发布前复审——backlog #12 schema 演进复审、#2 导出/导入、#8 全局安装演练、#4 token 统计评估。
> 评审基线：S11.1（`2b93d90` 生产构建全链路 14 项走查）与 S11.2（`671a700` 端到端冒烟 9 步链路）已完成通过；全仓测试 1225（shared 84 / db 187 / server 220 / client 356 / tools 225 / llm 59 / agent 94）。
> 评审日期：2026-08。评审结论由 oracle 评估（决策 13 的「首次发布前必须复审」承诺兑现）。

## 一、#12 schema 演进策略复审

### 现状核对

- 实现（`packages/db/src/queries/migration.ts`）：open 时 `getUserVersion` 与 `SCHEMA_VERSION` 比对，不匹配即 `rebuildProjectStorage`——wal_checkpoint(TRUNCATE) → 备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak` → 删旧库重建 + 重置 outline.json 空树；project.json 不动；回收站随新库清空。
- 触发点仅在 `POST /project/open`（project.ts），响应带 `rebuilt`/`fromVersion` 提示客户端。
- 已知限制（migration.ts 自注）：同版本号多次重建覆盖旧备份；**未来版本（user_version > 当前）同样触发重建**。
- 决策 13 约束：「此策略仅在正式发布前可接受；首次发布前必须重新评估」。

### 风险

1. 发布后每次 schema 升级 = 用户全部创作数据（大纲/实体/对话历史）重置为空；.bak 仅用于配合旧版本程序回滚，普通用户不可自救。
2. **降级路径最险**：用户安装新版后回退旧版程序 → user_version 更高 → 当前实现照样重建清零。
3. 同版本号备份覆盖：单版本内多次触发重建，备份互相覆盖，数据不可恢复。
4. 首次发布本身不触发重建（create 时版本号对齐），风险全部落在「发布后首个 schema 变更」与「降级回退」。

### 建议动作

1. **（发布前必须，约 5 行代码）** `user_version > SCHEMA_VERSION` 分支从「重建」改为「拒绝打开 + 明确错误提示升级程序版本」——堵住降级数据丢失路径。
2. **（发布前建议，不阻塞首发）** 发布后首个 schema 变更前实现**增量迁移脚本机制**（`migrations/` 按序执行 + `setUserVersion` + 迁移前自动快照带时间戳），约 100-200 行 + 测试。
3. **（文档）** 发布说明承诺「升级不丢数据」；决策 13 增补「删库重建策略于 v0.1.0 发布终止」。

### 优先级

**发布前必须**（仅「未来版本拒绝重建」一项，改动极小堵大洞）；迁移机制**发布前建议**（不阻断首发，但须在发布后首个 schema 变更前完成）。

## 二、#2 导出/导入

### 现状核对

- product.md 承诺原文：「用户可以**随时导出完整项目数据**，不被任何平台锁定」（原则 1「数据主权归用户」的直接载体）。
- 现状：server routes 无 export/import 端点；client 无导出 UI；shared 无相关契约。**承诺与实现零匹配，是明确的发布违约项**。

### 风险

1. 「数据主权、不被平台锁定」是产品差异化第一卖点——空头承诺直接伤害产品信用。
2. 用户换机/重装/磁盘故障无自救手段；与 #12 协同：无导出则用户对数据灾难完全无助。
3. 成本低、收益高。

### 建议动作（最小形态）

- **`GET /api/v1/project/export`** → zip 打包三文件（project.json + outline.json + data.db）；导出前 wal_checkpoint(TRUNCATE) 保证完整快照；天然不含 key（决策 17）。zip 实现建议 **fflate**（纯 JS 零原生依赖，~8KB，无 ABI 风险）——唯一新增依赖，需一并决策。
- **`POST /api/v1/project/import`** → 上传 zip 先校验到**临时目录**（三文件齐全 + 契约校验 + data.db user_version 校验），全绿后原子搬入**新书目录**（books/ 新建，不覆盖现有项目，与 create 的 `PROJECT_ALREADY_EXISTS` 语义一致）；user_version 不匹配拒绝导入提示版本不兼容（不静默重建）。
- 前端：设置页或书架页「导出（下载 zip）/ 导入（选文件）」入口 + toast。
- 契约进 `shared/types/api.ts`。

### 工作量预估

约 0.5-1 人日（2-3 张卡）：契约 + export 路由（~80-120 行）、import 校验 + 原子搬入（~100-150 行）、client UI + 联调（~80 行）、测试双向 roundtrip/坏包/冲突（~200-300 行断言，可复用 S11.2 冒烟 tmp 项目模式）。

### 优先级

**发布前必须**（backlog 触发条件 + 产品承诺违约 + 数据保全最后防线）。

## 三、#8 全局安装演练

### 现状核对

- 已自动化闭环：`pack:test`（build → 6 包 tarball → npm install）→ `start:test`（bin 启动）→ `test:packed`；prepack/postpack 钩子（copy-client-dist + workspace:* 替换）已实测；better-sqlite3 ^13 预编译无 ABI 问题。
- **剩余缺口**：① 6 包均无 `publishConfig`（`@whispering233/ai-editor-*` 是 scoped 包，npm 默认私有——直接 publish 会失败或进私有包，代码级硬阻断）；② 版本管理未落地（全仓 0.1.0，无统一 bump 脚本）；③ npm 账号/2FA/publish 顺序从未演练。

### 建议动作

1. **（发布前必须，一行 × 6 包）** 每包 package.json 加 `"publishConfig": { "access": "public" }`；发布前跑 `npm publish --dry-run` 验证包内容。
2. **（发布前必须，流程）** 真实演练一次完整 publish：按依赖序（shared → llm/db/tools → agent → server）发布 6 包 → registry 安装验证（`npm i -g ai-editor` + 启动 + 冒烟）。
3. **（发布前建议）** 版本管理：6 包同步版本（与根对齐），写 `scripts/publish.mjs` 或 changesets；至少把「版本号同步」规则写进发布文档。

### 优先级

**发布前必须**（publishConfig 确定性阻断 + publish 流程演练一次）；版本管理脚本**发布前建议**。

## 四、#4 token 统计评估

### 现状核对

- `llm/token.ts`：chars/4 估算 + lastUsage 真实基线——仅服务预算控制（决策 6/15），无统计沉淀。
- 运行时 usage 仅调试日志形态（`[llm] usage` 类别），不持久、不展示；client 无 token 展示 UI。
- 用户侧「成本失控」已被决策 15 三重保险兜底——缺的是**透明度**而非**保护**。

### 风险

做持久化统计 → 需 schema 变更（chat_messages 加 usage 列或新表）→ **触发首次 schema 变更 → 与 #12 强耦合**：发布后加列必须走迁移机制，等于把 #12 的迁移工作提前拖进来。

### 建议动作

1. **（可延后）** MVP 首发不做持久化统计与展示；维持现状（估算兜底 + 调试日志可观测）。
2. **（发布后）** 与迁移机制合并落地：首个 schema 变更顺带加 usage 列 + 会话列表累计字段 + client 展示。约 1 人日。
3. （零成本可做）会话级内存累计 + 日志，价值有限不推荐单独立项。

### 优先级

**可延后**（发布后与 #12 迁移机制合并）。backlog 原文亦为「建议补」而非「必须」。

## 五、发布就绪度总评

**当前不满足发布条件，缺口集中在 2 个代码项 + 1 个流程项，估算 1-1.5 人日 + 一次演练即可就绪。**

### 发布阻断项（必须清零）

> **实施进展（2026-08-04）**：E1-E5 完成（导出/导入三卡 `8706f63`/`0c1ecf7`/`9e7c60e`、未来版本拒绝重建 `e53d261`、增量迁移机制 `023c2b5`）；E6 基础落地（publishConfig/脚本/workflow/包名改 `@whispering233/ai-editor-*`——`@ai-editor` scope 被占）/ 6 包已发布 npm（v0.0.3 为首个可安装版本，发布管道经两轮修复：npm 12 manifest 时序 → 发布前主动替换 + `--ignore-scripts`）。**剩余：npmjs Trusted Publisher ×6 配置（需先开 2FA）、坏版本 v0.0.1/v0.0.2 deprecate、CI 全链路重测**——细分与坑记录见 `doc/design/tasks.md` E6 卡「当前状态」段。

| # | 项 | 性质 | 工作量 |
|---|----|------|--------|
| 1 | ~~#2 导出/导入~~ | **已完成（E1-E3）** | ~0.5-1 人日（2-3 卡） |
| 2 | ~~#8 publishConfig.access=public（6 包）~~ | 待做（E6） | 一行 × 6 |
| 3 | #8 npm publish 真实演练 | 待做（E6，流程） | ~0.5 人日 |
| 4 | ~~#12 未来版本拒绝重建（user_version > SCHEMA_VERSION 分支）~~ | **已完成（E4）** | ~5 行 + 测试 |

### 发布前建议（不阻断）

- #12 增量迁移脚本机制（发布后首个 schema 变更前必须落地，发布窗口内完成最佳）
- #8 版本管理脚本 / 版本同步规则
- 文档：决策 13 增补「v0.1.0 发布终止删库重建」；发布说明承诺「升级不丢数据」+「随时可导出」

### 可延后（发布后迭代）

- #4 token 统计（与迁移机制合并做）
- 其余 backlog（#1 多标签页、#3 undo、#5 性能、#6 缓存）维持不做

### 关键耦合提醒

**#4 与 #12 强耦合、#2 与 #12 协同**：任何「加列/加表」功能要么在发布前（借删库重建最后窗口）做完，要么等迁移机制就绪。若发布窗口内计划增加数据形态，应优先于 #12 迁移机制实施，一次性享受「发布前免迁移」红利；否则一律推迟到迁移机制后。

## 六、发布决策确认（2026-08 用户裁决）

1. **导出/导入 zip 库选型**：采用 **fflate**（纯 JS 零原生依赖，无 ABI 风险）。
2. **#8 演练方式**：采用**真实 npm publish**（无 CI 前提下更贴近真实；包可撤回）。
3. **迁移机制窗口**：**发布窗口内做**——增量迁移脚本机制随发布阻断项一起实施，首个 schema 变更前就绪。

对应实施任务卡已切分至 `doc/design/tasks.md`「发布前阻断项（E1-E6）」。

