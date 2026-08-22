# 关键架构决策

## 决策 1：节点即大纲（统一模型）

大纲的树状结构和剧情探索的图状结构共享同一数据中心。**所有节点都挂在大纲树上**，不存在游离节点（决策 19）；画布上的剧情连线是关系数据 `plot_edge`（决策 10），不是独立存储。

```
大纲视图（树）         画布视图（图）
 卷1                       🎯 结局
 ├ 第1章              ┌────┘
 │ ├ 场景A ←──────────┤ 同一数据
 │ └ 场景B            └────┐
 └ 第2章                   路径A ─→ 路径B
                        （plot_edge 剧情连线）
```

- 在大纲里拖拽重排 → 画布上的投影自动更新
- 画布上可自由摆放节点（坐标/缩放存 localStorage，决策 10）与绘制推演连线（`plot_edge`，决策 10）
- 两个视图不是「同步」关系，而是同一数据的两种**投影**

## 决策 2：通用关系表

不走「人物关系表 + 设定关系表 + 地点关系表」的分表路线，而是用一张表统一管理所有跨实体关系：

```
relation_records
├── (人物, char-3) ──[所属]──→ (设定, set-7)
├── (人物, char-3) ──[出现于]──→ (大纲节点, sc-1)
├── (设定, set-7) ──[总部]──→ (地点, loc-1)
└── (大纲节点, sc-37) ──[剧情连线]──→ (大纲节点, sc-52)   # plot_edge
```

**理由**：
- 新增关系类型不需要改表结构（只需扩展常量）
- AI 分析时一次查询拿到全图，不需要 JOIN 多张表
- 从任意实体出发的「查找所有关联」是一个查询

## 决策 3：Delta 变更追踪

人物/设定的属性不是静态的——第 47 章主角黑化了，战力从 100 涨到 850。如何表达这种变化？

**不采用版本快照**（每个节点存储完整状态 → 冗余，看不到因果）。

**采用事件驱动 Delta**：大纲节点记录自己**引发了什么变化**。

```
sc-37(获得断剑认可) → Delta: 张三.战力 +50
sc-52(被挚友背叛)   → Delta: 张三.性格 善良→多疑
```

到达任意节点的状态 = 初始值 + 从根节点到该节点路径上所有 Delta 的累积。Delta 存储在独立的 `delta_records` 表中（见 `doc/database/schema.md`），不侵入大纲的 JSON 结构。（2026-08 修订：原『挂载在通用关系表 attribute_change』的表述作废，统一为独立表。）

## 决策 4：双轮驱动（人物 ↔ 剧情）

不存在「先捏人再推剧情」或「先定剧情再补人物」的主从关系。两个方向并行，互相喂养：

```
         ┌──────────────┐
         │   人物系统    │
         │  角色库       │
         └──┬────────┬──┘
            │        │
   性格决定  │        │  场景需要
   剧情走向  │        │  角色补位
            │        │
         ┌──┴────────┴──┐
         │   剧情探索    │
         │  画布+AI推演  │
         └──────────────┘
```

用户可以从任何方向启动，另一方自动响应——比如在画布上加一个新场景，AI 会分析缺少什么角色；在人物系统里新增一个角色，AI 会提示该角色可以出现在哪些已规划的剧情节点中。

## 决策 5：大纲用 JSON，实体用 SQLite

| 数据 | 格式 | 理由 |
|------|------|------|
| 大纲树 | JSON 文件（`outline.json`） | 天然树形结构，整树读写，无需拼接 |
| 实体/关系/Delta | SQLite（`data.db`） | 结构化查询、关联追踪、Delta 累积计算 |

**不采用全 SQLite 或全 JSON 的统一方案**——大纲的树形结构与关系表的查询需求对存储格式的要求天然不同，强行统一反而增加复杂度。

## 决策 6：分层上下文策略

DeepSeek 有 64K token 上下文窗口，但不能每次把整个世界发给 AI。采用四级分层：

```
系统指令 (~500 tokens)       # 固定：AI 角色定义 + 行为规范
聚焦上下文 (~3000 tokens)    # 动态：当前视图中的实体 + 紧邻关系
扩展上下文 (按需查询)        # AI 通过工具调用主动拉取
对话历史 (~6000 tokens)      # 滑动窗口 + 超限压缩摘要
```

- **usage 基线（2026-08 补充，借鉴 pi）**：预算计算优先采用「最近一次成功响应的真实 usage」，其后消息按 `chars/4` 估算；**裁剪/重排历史后必须重置 usage 基线**——旧 usage 描述的是裁剪前的前缀，直接沿用会导致预算漂移（pi `latestPrefixTimestamp` 同类问题）。

## 决策 7：提示词三层注入

System Prompt 不是一成不变的，而是可编辑的分层结构：

```
最终 Prompt = 内核提示词(代码固定) + 项目提示词(用户可编辑) + 临时指令(即时输入)
```

| 层 | 编辑者 | 持久化 | 示例 |
|----|--------|--------|------|
| 内核 | 开发者 | `agent/prompts.ts` | 「你是创作顾问，不生成正文」 |
| 项目 | 用户 | `project.json` | 「力量体系：练气→筑基→金丹」 |
| 临时 | 用户 | 不持久化 | 「今天只讨论第三卷」 |

## 决策 8：单命令 + 单进程部署

用户的工作流是：**全局安装，进入项目目录，运行一条命令，在浏览器中完成所有操作。** 不存在 CLI 子命令操作数据。

### 代码与数据物理隔离

```
# 代码（用户不可见）
~/.nvm/versions/node/v22/lib/node_modules/ai-editor/
├── dist/api/index.js     ← 编译好的 Hono 服务端
└── dist/client/          ← Vite build 产物（SPA）

# 数据（用户在项目目录下管理）
~/projects/my-novel/
├── project.json           ← 项目元信息 + 用户提示词
├── outline.json           ← 大纲树
└── data.db                ← SQLite（实体/关系/Delta）
```

- 代码装在 node_modules，数据在用户项目目录
- 用户目录里没有构建配置、TypeScript、node_modules——全是纯创作数据
- 用户不需要知道代码在哪

### 启动流程

```
用户终端:
  ① cd ~/novels（创作根）
  ② ai-editor                            ← 唯一命令

CLI 入口:
  ③ 拿到 process.cwd() → ~/novels
  ④ 检测 project.json 是否存在
     存在   → 直接加载（旧单项目部署「启动即用」，兼容）
     不存在 → 书架模式：不初始化、不建任何文件，待命
              （2026-08 修订：原「不存在 → 自动创建三文件」取消——空目录不应被替用户
               决定初始化，且 dev 态（cwd=包目录）会污染代码包）
  ⑤ 启动 Hono 服务端，传入创作根路径
  ⑥ 自动打开浏览器 → http://127.0.0.1:3456（Dashboard 书架）

书架模式（2026-08，参考 inkos）:
  启动目录 = 创作根，创建书 = 创作根下 books/<书名>/ 子目录（含三文件）
  GET /api/v1/project/list 扫描 books/ 列书（不依赖当前项目）
  create/open 契约不变（绝对路径），前端把书名拼接为 创作根/books/<书名>/ 调用

之后所有操作都在浏览器 GUI 中完成：
  ├── 管理人物/设定/地点
  ├── 编辑大纲树
  ├── 在画布上探索剧情路径
  └── AI 对话
```

**端口占用**：3456 被占用时自动尝试下一个端口（+1 递增），并打开实际端口（与决策 17 统一）。注意用 `127.0.0.1` 而非 `localhost`——IPv6 优先系统上 localhost 可能解析为 `::1` 导致连接被拒。

### 单进程架构：Hono + SPA 同端口

```
Node 进程（Hono 服务器） :3456
  ├── /api/v1/*      → 处理 API 请求（操作 project.json / data.db / outline.json）
  ├── /assets/*      → 返回 Vite build 产物的 JS/CSS 文件
  └── /*             → 返回 index.html（SPA 路由回退）
```

同一端口、同一个进程同时做两件事：
- API 服务（数据读写）
- 前端静态文件托管（SPA 页面）

**理由**：
- 用户只需要一条命令（不需要先启动 Vite dev server，再启动 API server）
- 不需要 Nginx 或反向代理
- 开发态和发布态统一入口：dev 模式用 Vite proxy，生产模式用 Hono 直伺服态文件

### 入口脚本设计

`package.json` 中声明 bin：

```json
{
  "name": "ai-editor",
  "bin": {
    "ai-editor": "dist/cli.js"
  }
}
```

`dist/cli.js` 的逻辑极简——不解析子命令，不提供交互式参数：

```typescript
#!/usr/bin/env node
import { startServer } from './server.js';

const projectRoot = process.cwd();        // 当前目录即项目目录
const port = process.env.PORT ?? 3456;
const actual = await startServer(projectRoot, port);  // 端口占用时内部自动 +1 递增，返回实际端口
openBrowser(`http://127.0.0.1:${actual}`);            // 打开实际端口（决策 17）
```

没有任何子命令解析逻辑，用户不需要学习任何 CLI 操作。

### 项目自动初始化

首次在空目录运行时，自动创建项目骨架：

```typescript
export async function ensureProjectInitialized(dir: string): Promise<boolean> {
  const configPath = join(dir, 'project.json');
  if (existsSync(configPath)) return false;   // 已有项目，跳过

  // 首次自动初始化：三个文件写入时都带上版本号（衔接决策 13）
  const schemaVersion = SCHEMA_VERSION;                       // 当前 schema 版本常量
  writeFile(configPath, JSON.stringify(
    buildDefaultConfig(dir, { schema_version: schemaVersion })
  ));
  initDatabaseSchema(db, schemaVersion);      // 建表（含 chat_messages）+ 写入 PRAGMA user_version
  writeFile('outline.json',
    `{"id":"root","type":"root","schema_version":${SCHEMA_VERSION},"children":[]}`);
  return true;  // 新初始化
}
```

用户甚至不需要执行 `init` 命令——进入空目录直接 `ai-editor` 即可开始使用。

### 为什么不采用复杂 CLI

| 方案 | 复杂度 | 用户学习成本 | 场景匹配 |
|------|--------|-------------|---------|
| InkOS 式多子命令 CLI | 高（30+ 命令） | 高 | 面向重度终端用户 |
| 单命令 + GUI | 低（1 条命令） | 几乎为零 | 面向小说创作者 |
| 纯桌面应用 | 中（打包分发） | 零 | 需跨平台分发 |

AI Editor 的目标用户是**写小说的人**，不是开发者。纯 GUI 交互最符合直觉。一条命令启动浏览器后，所有操作在图形界面完成，不需要记忆任何命令。

## 决策 9：Delta 只沿大纲树父链累积（含推演语义）

- 状态计算 `computeState(target, at_node_id)` 只沿**大纲树父链**（根 → 目标节点）累积已确认的 Delta；树路径唯一，结果确定可复现。
- **双层排序**：节点间按树路径顺序（根 → 目标节点）；同一节点内的多个 Delta 按 `order` 递增应用。节点移动（move）后路径顺序天然正确，不依赖全局 `order`。
- Delta 的 `op=update` 应用时**校验当前值等于 `from`**；不匹配则**跳过该 change 并继续累积**，不再返回 409——手动编辑实体 data（PUT /entity 自由合并）不产生 Delta，旧 Delta 的 `from` 与实际值断裂是正常用户行为而非异常，跳过+标注让状态计算保持可用；computeState 响应在 `appliedDeltas` 中标注 skipped、在新增 `conflicts` 字段给出 `{ field, expected, actual, deltaId }` 供用户/AI 感知不一致并修复（2026-08 修订：原『返回 409 `DELTA_CONFLICT`，由调用方感知不一致，不静默跳过』作废）。
- 画布上的推演连线（`plot_edge`）不参与状态计算。
- 推演（what-if 分析）是「只读路径计算 + 提案生成器」：AI 推演产生的状态变化**不落库、不进入主状态**，只以提案形式呈现，用户确认后由 executor 写入 `delta_records` 成为事实。推演永不直接写数据。

**为什么**：树路径唯一才能保证状态计算结果确定可复现；推演与事实分离，避免 AI 的假设污染创作数据。

## 决策 10：画布连线用 plot_edge 关系类型

> **2026-08 修订（决策 33）**：画布页 UI 已移除（未批次八 O6），但**本决策的数据模型语义不变**——`plot_edge` 关系类型、`POST/GET/DELETE /relation` 接口能力完整保留，仅不再有画布 UI 入口；旧 localStorage 坐标为无害残留（不清理、不迁移）。

- 画布上的剧情连线（大纲节点 → 大纲节点，如「路径A → 路径B」）通过 `relation_records` 新增的 `plot_edge` 关系类型存储，`metadata` 存连线标签（如「路径A」）。
- `plot_edge` 仅用于路径推演分析（`trace_plot_paths`），不参与状态计算（见决策 9）。
- 画布是同一数据的投影：连线是关系数据；节点坐标（x/y）与画布缩放存浏览器 localStorage（纯展示层，key 按 project_id 隔离），不参与数据同步、不参与状态计算，换设备/浏览器丢失布局可接受（布局非创作数据）。

**为什么**：连线本质是节点间的关系，放进通用关系表即可复用遍历/查询能力，无需为画布单独建存储；坐标/缩放属展示层，只存浏览器 localStorage，不进任何数据文件（outline.json / data.db）。

## 决策 11：outline.json 原子写

- 大纲整树保存采用「写临时文件 → fsync → rename 覆盖」的原子写流程，保证崩溃/断电时旧文件完好。
- 不允许直接覆盖写。

**为什么**：大纲是用户的核心创作资产，整树写覆盖一旦中途崩溃即损坏；原子写保证任意时刻磁盘上要么是旧文件要么是新文件。

## 决策 12：软删 + 回收站

- 实体与大纲节点删除采用**软删**：entities 表标 `deleted_at`；大纲节点标 `deleted` + `deleted_at`（时间戳支撑回收站列表与定期清理），不物理删除。
- **级联软删**：软删实体/节点时，其关联的关系与 Delta **一并软删**——`relation_records` / `delta_records` 标 `deleted_at`；常规查询默认过滤软删对象，回收站 API 是访问软删对象的唯一入口。
- **手动删关系 = 物理删**：用户/画布直接删除关系（`DELETE /relation/:id`）立即物理清除，不进入回收站——关系是轻量可重建对象（随时可重新建立），`deleted_at` 标记仅服务于级联软删场景。
- **关系可见性联动端点状态**：常规查询过滤关系时校验其 source/target 端点均未软删（任一端点软删即不可见）；**restore 级联还原全部关系**（不因端点仍软删而跳过），端点还原后关系自动可见——数据永不丢失，也不会出现指向回收站对象的「幽灵关系」。
- **级联还原**：restore 时还原本体 + 关联的关系与 Delta；**purge** 时才物理清除（实体连同其关系与 Delta，节点连同递归子树）。
- **restore 父链约束（2026-08 修订）**：还原大纲节点时校验其祖先链——存在软删祖先则拒绝并返回 409 `OUTLINE_ANCESTOR_DELETED`（提示先还原祖先），杜绝「可见节点挂在不可见父」的畸形树。
- **Delta 可见性联动触发节点与目标实体（2026-08 修订）**：与关系同规则——触发节点或目标实体任一软删，该 Delta 在常规查询与 computeState 中均不可见；restore 级联还原后若任一端仍软删，同样暂不可见。
- **软删/还原更新 `updated_at`（2026-08 修订）**：实体与节点的软删、还原均更新 `updated_at`（与常规编辑一致），保证提案快照比对（决策 14）语义统一——删除/还原后基于旧快照的提案必然 `PROPOSAL_STALE`。
- UI 提供回收站与还原入口；回收站定期清理（按 `deleted_at` 判定保留时长）。

**为什么**：创作场景误删成本高，软删为还原留余地；关系与 Delta 随本体一并软删，避免悬挂引用，还原时数据完整恢复；关系高频可重建故手动删除走物理删；可见性联动端点状态保证「还原必可见、可见必有效」。

## 决策 13：schema 演进 —— MVP 删库重建

- ~~MVP 不做数据迁移~~（**已由文末 E5 增补替代（2026-08 修订）**）：原 MVP 口径为 `data.db` 通过 `PRAGMA user_version` 记录 schema 版本，启动时检测不匹配则**删除重建**并提示用户；`project.json` 增加 `schema_version` 字段。
- **版本判定规则**：以 data.db 的 `user_version` 为准判定是否重建；`project.json` 的 `schema_version` 仅用于 JSON 结构判断；首次初始化时两个版本号都写入（见决策 8 初始化流程）。
- **重建时同步重置 outline.json**（先备份为 `outline.json.v{n}.bak`，n=旧 schema 版本号）并清空回收站，避免「大纲完整、实体全空」的半状态；**旧 data.db 一并备份为 `data.db.v{n}.bak`**——对话历史属创作数据（决策 18），重建不可静默丢弃。
- **备份带版本号、不覆盖旧备份（2026-08 修订）**：多次重建各自留档；手动恢复 .bak 仅用于配合**旧版本程序**回滚——当前版本下 user_version 仍不匹配、再次重建属预期行为。
- outline.json 顶层携带 `schema_version` 字段（与 project.json 同步写入，用于文件格式演进判定）。
- ~~不写迁移脚本（YAGNI）~~（**已由文末 E5 增补替代（2026-08 修订）**）。
- **约束**：此策略仅在正式发布前可接受；首次发布前必须重新评估（发布后用户持有真实创作数据，删库不可接受）。
- **删库重建策略于 v0.1.0 发布终止（E5 增补）**：增量迁移机制替代——旧版本库（user_version < SCHEMA_VERSION）**有迁移路径**（`MIGRATIONS` 存在连续迁移链）→ 前向迁移（每迁移一个事务、`setUserVersion` 原子提交、迁移前时间戳快照 `data.db.v{n}.{时间戳}.bak`）；**无迁移路径**的历史版本保留重建兜底；未来版本（> 当前）仍按 E4 拒绝打开。首个真实迁移条目在 SCHEMA_VERSION 提升时加入 `packages/db/src/migrations/`。

**为什么**：MVP 阶段 schema 必然频繁变动，迁移脚本成本高收益低；删库重建换取开发速度，代价由「未发布无真实数据」这一前提兜底。存储双轨下只重建 data.db 会留下大纲与实体割裂的半状态，必须同步重置 outline.json 并留备份。

## 决策 14：提案生命周期 —— 仅内存

- 提案（proposal）仅存服务端内存，随 SSE 事件推送，不落盘。
- 确认（confirm）时服务端**重新校验**：提案引用的实体/大纲节点仍存在，且快照一致——entities / relation_records / delta_records 用自身 `updated_at`；大纲节点用 outline.json 节点级 `updated_at`（决策 19）；校验失败返回 409 `PROPOSAL_STALE`，前端提示重新生成提案；proposal_id 不存在返回 404 `PROPOSAL_NOT_FOUND`。
- 提案 Map 加 **TTL（10 分钟）与条数上限**，超期/超限自动清除；无跨会话恢复（提案是瞬态交互对象）。
- **提案绑定项目（2026-08 修订）**：提案对象携带 `project_id`；confirm/reject 时校验与当前项目一致，不匹配返回 409 `PROPOSAL_PROJECT_MISMATCH`；create/open/close 切换项目时**清空全部内存提案**并强制结束进行中的 SSE/agent 循环（衔接决策 16 取消语义；原 backlog #10 服务端部分提前到 MVP）。

**为什么**：提案是毫秒级的交互对象，落盘与恢复机制收益为零；「存在性 + updated_at 快照比对」的双重校验防止「提案生成后数据已被其他操作改变」导致的脏写入；TTL/上限防止用户挂卡不确认导致内存无限增长。

## 决策 15：agent 循环终止与失败处理

- 主循环设三重保险：max iterations（8 轮）、单轮超时（120s）、token 预算上限。
- 工具执行失败时以**结构化文本喂回 LLM 自纠**；超限则发 `error` 事件终止循环。
- 模型调用失败（429/5xx/超时）按重试策略（`llm/retry.ts`）退避重试，最终失败以 error 事件呈现。
- **重试分类（2026-08 补充，借鉴 pi）**：`retry.ts` 区分两类错误——**不可重试**：配额/计费类（402、`insufficient_quota`、billing 等），确定性错误**快速失败**直接发 error 事件，重试纯浪费；**可重试**：传输与瞬时类（429/5xx/超时/网络断开），指数退避 `baseDelay * 2^(n-1)`（参考默认 maxRetries=3、baseDelay=2s，即 2s/4s/8s）。**abort 永不重试**；退避 sleep 期间监听 abort 即时中断。
- **重试计数（2026-08 补充，2026-08 修订）**：报告口径为**全程累计**（最后一次成功轮前的重试次数）；「成功即清零」的预算语义由 withRetry 的 maxRetries 独立限制 + roundDeadline 兜底承担（无跨轮累计消耗预算问题）；重试次数与轮次分开计量，不互相消耗。
- **超时口径（2026-08 补充）**：120s 为**单轮总预算**（含 LLM 重试退避与工具执行），LLM 单次 attempt 另有自身 fetch 超时；预算耗尽发 `error` 事件终止。
- **length 截断不执行工具（2026-08 补充，借鉴 pi）**：`finish_reason === "length"`（max_tokens 截断）时**一律不执行任何 tool_call**——流式拼接的 tool_call 参数可能「解析且校验通过但静默不完整」，全部标记为错误让模型重发（pi `failToolCallsFromTruncatedMessage` 同款语义）。

**为什么**：LLM 可能陷入死循环或失控调用，必须用硬性预算兜底；失败语义对用户可见（error 事件），不静默吞掉。

## 决策 16：SSE 中断全链路取消

- 浏览器刷新/断网导致 SSE 断开时，服务端通过 AbortController 全链路取消：agent 循环终止、DeepSeek fetch 中止。
- **取消信号四层穿透（2026-08 补充，借鉴 pi）**：同一 AbortController 必须贯穿四层——① DeepSeek fetch 的 signal；② SSE 读循环**逐 chunk 检查** aborted（命中即抛 "Request was aborted"）；③ 工具执行（长分析工具执行中检查 signal，参照 pi bash 监听 abort 杀进程树的思路）；④ 重试退避 sleep（abort 即时唤醒且该次重试取消）。任一层缺失都会让取消延迟到单轮 120s 超时（决策 20 同类问题）。
- 未确认提案作废；正在执行的写操作完成当前一步后停止。
- 写操作顺序固定为**先 DB 后 JSON**（data.db 先行、outline.json 随后）；两存储间无原子性，断电/取消可能造成「DB 已写、JSON 未写」的不一致。
- **启动一致性校验兜底（2026-08 修订）**：打开项目时自动比对 outline.json 节点软删标记与 data.db 中 relation/delta 软删状态，**以大纲节点软删为准**补标 DB 侧缺失的 relation/delta `deleted_at`（决策 12 单向不变式：节点软删 ⇒ 关联记录必软删，无误报）并写日志；反向（DB 记录已软删、节点未软删）推断受实体侧级联干扰不可靠，不在补标范围。检测工具 `find_orphan_elements` 保留为诊断用途，返回 `inconsistent_soft_deletes` 形态并引导修复。
- 未确认提案**按产生它的会话作废**（提案记录来源 session_id；SSE 流取消或项目切换时一并清除）。**MVP 实现口径（2026-08 修订，B2 取舍）**：S7.6 SSE 取消时 `store.clear()` **全量作废**——单项目单会话 MVP 下取消只发生在客户端断连（当前会话）或项目切换（提案本已按项目清空）场景，与按会话作废等价；Proposal 暂不含 session_id，多会话并发（backlog 多标签页）时按会话清除演进。
- 客户端重连后提示「上次会话已取消」。

**为什么**：SSE 断开后继续跑 agent 是纯浪费（结果无处可送），且未确认提案残留会造成状态不一致；全链路取消保证资源及时释放。跨 data.db 与 outline.json 两存储无法做到事务性回滚，故不承诺回滚，改为固定写序 + 检测工具兜底。

## 决策 17：安全基线

- 服务默认绑定 `127.0.0.1`，不对外网开放；端口占用时自动 +1 递增并打开实际端口（与决策 8 统一；**dev 态除外**——开发环境端口被占直接报错提示手动指定 PORT，见 architecture.md 开发态说明）。
- 中间件对**全部请求**（含读）校验来源：`Origin` 头存在时校验其 **host ∈ {`127.0.0.1`, `localhost`, `::1`}**；**Origin 缺失**（地址栏直接导航打开首页的常规浏览器行为）时退化为校验 `Host` 头 host ∈ 同一白名单。两者皆拒则拒绝（DNS rebinding 下读操作同样是敏感操作，防 CSRF / DNS rebinding）。
- **不校验端口（2026-08 修订）**：端口因占用自动 +1 可变；dev 态 Vite proxy 转发后 Origin/Host 端口为 5173，校验端口会误杀全部开发请求。DNS rebinding 防护的关键是 host 白名单，端口校验无安全增益。
- DeepSeek API key：环境变量 `DEEPSEEK_API_KEY` 为主；设置页可配置并写入用户级配置文件（如 `~/.ai-editor/config.json`）。**key 不进入项目文件**（project.json / outline.json / data.db），保持「代码与数据物理隔离」。
- 项目路径校验：create/open 时路径需规范化（resolve）、防护符号链接逃逸；open 必须校验 `project.json` 存在。

**为什么**：本地工具的服务进程若被外网/恶意页面利用即可读写用户全部创作数据，本机绑定 + 全请求来源校验 + key 隔离把攻击面压到最小。

## 决策 18：对话历史持久化

- 新建 `chat_messages` 表入 data.db：session_id、project_id（会话按项目隔离）、role（user/assistant/tool）、content、tool_calls（JSON）、**tool_call_id**（tool 消息关联其 assistant 工具调用的 id）、created_at（见 `doc/database/schema.md`）。
- MVP 只存原始消息，不做摘要持久化；会话级滑动窗口裁剪与摘要压缩仍在 agent/session.ts 运行时完成（决策 6 分层上下文策略）。
- **历史重建规则**：续聊时按 `assistant.tool_calls[].id` ↔ `tool.tool_call_id` **成对重组**喂回模型（DeepSeek 要求严格配对，缺一即拒绝请求）；滑动窗口裁剪**必须成对**（tool_call 与对应 tool_result 同裁同留）。
- **孤儿半对处理（2026-08 修订）**：中断若落在 tool_call 已写、tool_result 未写（或反之）之间，历史重建与裁剪时**整对丢弃**，不喂回模型。
- **重试/续聊末条约束（2026-08 补充，借鉴 pi）**：喂回模型的消息序列末条**必须是 user 或 tool 消息**——assistant 结尾的序列 DeepSeek 直接拒绝（pi 重试入口同款约束：assistant 结尾抛错）；模型调用失败重试时**复用原请求的 messages 数组**，绝不追加失败轮的半条 assistant 产物。
- 服务重启后通过 session_id 重建「继续上次对话」；会话列表/历史查询走 `GET /api/v1/chat/sessions` 与 `GET /api/v1/chat/sessions/:id/messages`（见 `doc/api/endpoints.md`）。
- 兑现 product.md「对话历史在本地保存」的承诺。

**为什么**：对话历史是本地创作数据的一部分，落库后重启不丢、可续聊；工具调用成对性是模型 API 的硬约束，不落盘 id 则续聊必然失败；摘要持久化属优化项，MVP 不做（YAGNI），裁剪压缩留在运行时即可。

## 决策 19：大纲严格三层，无游离节点

- 大纲树固定三层：**volume（卷）→ chapter（章）→ scene（场景）**，所有节点必须挂在大纲树上，**不存在游离节点（orphan_nodes）**。
- 创建规则：`volume` 挂 `root`；`chapter` 挂 `volume` 或 `root`；`scene` 必须挂 `chapter`。创建时必须显式指定 `parent_id`，无默认值。
- outline.json 不再有 `orphan_nodes` 字段；move 接口不再支持 `__orphan__` 目标。
- **节点版本戳**：outline.json 每个节点携带 `updated_at`（ISO 时间戳），节点任何字段变更（title/summary/children 重排）时由服务端原子写时统一更新；顶层携带 `schema_version`（文件格式演进判定，衔接决策 13）。节点级 `updated_at` 同时支撑决策 14 的提案快照比对。
- 关联影响：决策 9 删除「游离节点仅累积直接挂载 Delta」规则（树路径唯一即涵盖全部语义）；画布不再有「游离节点拖入归位」交互（决策 1）；backlog #11（孤儿节点层级限制）取消。

**为什么**：游离节点制造了「树外状态」的语义裂缝——状态计算、软删级联、提案快照都要为它开特例，且与「节点即大纲」的统一模型冲突；取消后路径唯一、规则单一，全链路简化。

## 决策 20：SSE 心跳与断开检测

- `/api/v1/chat` 的 SSE 流每 15-30 秒发送一次 `ping` 事件（空 payload，仅维持连接活性与探活）。
- **三路断开检测**：`stream.onAbort` 回调 + `c.req.raw` 的 close/error 监听 + 心跳写失败，任一触发即通过 AbortController 全链路取消（agent 循环终止、DeepSeek fetch 中止，衔接决策 16）。
- 客户端侧同样监听流结束/`onAbort`，显示「上次会话已取消」并清理未确认提案卡片。

**为什么**：@hono/node-server 只能靠写失败感知客户端断开；agent 等待模型响应期间（单轮最长 120s，决策 15）无任何写操作，无心跳则断网后取消延迟可达 120s，「断开即取消」（决策 16）名存实亡。心跳让探活与取消时延收敛到秒级。

**已知限制（2026-08 补充）**：心跳对 **TCP 半开连接**（客户端断电而非正常关闭）无法即时感知——写进内核缓冲不失败，感知延迟回到 TCP 重传超时（分钟级）；客户端需自身超时兜底（如 60s 无任何事件即提示连接断开）。

## 决策 21：伏笔健康指标口径（2026-08 新增）

伏笔系统（`doc/database/hooks.md`）的年龄/休眠类指标依赖「章节序」与「预计回收节点」，原文档未定义推导规则，实现必返工。统一如下：

- **章节序推导**：全局**章**序号（跨卷连续累计），按大纲树先序遍历编号（root → 卷 → 章，直接挂 root 的 chapter 按兄弟顺序编号）；scene 归入所属 chapter，不单独编号；`current_position` 指向 scene 时取其所属章序号。
- **chapter 不落库**：`plants` / `advances` / `resolves` 关系**不存 chapter 元数据**——由服务端基于关系 `source_id` 从大纲树**查询时现推**（节点 move 后不陈旧，原 metadata.chapter 反规范化作废）。
- **ready_to_resolve 数据来源**：hook data 新增可选字段 `expected_resolve_node_id`（大纲节点 id）；指标 = `current_position` 章节序 ≥ 该节点章节序；未设置时该指标返回未计算，不猜测。
- **half_life 缺省映射**：显式 `half_life` 优先；未设置时按 `payoff_timing` 映射默认值（章）：`immediate`=3、`near_term`=8、`mid_arc`=15、`slow_burn`=25、`endgame`=40。
- **`_health` 不入库**：运行时计算，仅作为 API 响应附加字段返回，绝不写回 `data`（避免 GET/PUT 把它当持久字段）。

**为什么**：健康指标是伏笔系统（产品差异化卖点）的数值基础，口径不定则所有指标语义漂移；一次性定死推导规则，避免实现者各选一套。

## 决策 22：三栏工作台布局与会话归属项目模型（2026-08 新增）

UI 布局从「顶栏 + 侧栏 + 内容区」重构为**三栏工作台**（借鉴 inkos 文学氛围工作台），并确立聊天会话的项目归属语义。

- **三栏布局（1:5:4 固定）**：左栏 10%（产品标识 + 书架 + 设置 + 主题切换）、中栏 50%（项目信息条 + tab 导航 + 页面内容）、右栏 40%（AI 聊天常驻）。左右栏固定不可拖拽；`<1024px` 时右栏折叠为抽屉。
- **中栏 tab 与路由一一对应**：概览 `#/`、大纲 `#/outline`、画布 `#/canvas`、实体关系 `#/entities/:type/:id`、伏笔 `#/hooks`、回收站 `#/trash`；设置 `#/settings` 移入左栏底部。
- **`#/chat` 独立页移除**：聊天常驻右栏；跨页「问 AI」不再跳页，改为注入右栏当前会话的 focus context（`focus_entity_type` / `focus_entity_id` / `focus_node_id`）。
- **会话归属项目**：会话不是全局的——每个项目有自己的会话列表（chat store 持有 `currentProjectId` + `currentSessionId`），左栏书架项目可展开会话列表切换；切项目重置会话上下文。数据层无需变更（`chat_messages` 已有 `project_id` 列，决策 18）。
- **会话恢复（2026-08 补充）**：刷新页面/打开项目时，会话列表加载后若无当前会话且列表非空 → **自动激活最近会话**（服务端按最后活动倒序第一条），符合「一项目一会话」的恢复心智；`newSession` 作废在途列表请求，防止自动激活把「开新会话」意图拉回。
- **主题系统**：shadcn 官方 oklch tokens（`@theme inline` + `@custom-variant dark`），双主题（浅：暖羊皮纸+牛血红+金箔 / 深：蓝黑曜石+琥珀烛光），手动切换 + localStorage 持久化；字体用系统字体栈（不下载 web 字体，本地优先离线可用）。

**为什么**：创作工具的核心工作流是「边写边问 AI」——聊天常驻右栏消除页间跳转摩擦（原 layout.md 的「带上下文进聊天」需跳 `#/chat`）；会话归属项目符合「一项目一创作语境」的心智模型（inkos 书→会话树已验证）；主题 tokens 标准化是 shadcn/ui 组件的先决条件（原自研 zinc 硬编码无法支撑后续组件库）。

> **修订注记（2026-08，用户反馈批次 F7）——三栏可收起/展开 + 拖拽调宽**。MVP 三栏 flex-basis 百分比固定（10%/50%/40%）不可拖拽，用户实测反馈：需要「三栏均可收起展开，拖动调整宽度」。设计裁决：**flex-basis 固定百分比 → 可拖拽宽度 + 可收起/展开 + 状态持久化**——① 左右栏之间与中右栏之间增加拖拽手柄（resize 手柄，拖动改栏宽，按像素而非百分比）；② 每栏可收起（收起为窄条/图标态，点击展开恢复），中栏不可完全收起（保底最小宽度）；③ 宽度与收起态存 **localStorage**（决策 10 同哲学——纯展示层，不进数据文件，本地偏好持久化）；④ `<1024px` 小屏右栏折叠抽屉行为**保持不变**（drawer 语义不受影响）；⑤ 无项目打开（Dashboard 引导态）时布局同样适用收起能力。布局语义：收起左栏/右栏 → 剩余空间由未收起栏弹性分配（中栏自适应）；拖拽宽度与收起态互斥（收起时拖拽手柄隐藏/禁用）。文档：`doc/ui/layout.md` §0（宽度实现节重写）。

## 决策 23：大纲节点结构化信息（麦基《故事》字段集，2026-08 新增）

大纲节点长期只有 title/summary 自由文本（S2），作者无法挂载结构化信息、AI 无法感知节点叙事功能（用户反馈 2026-08：节点"只有标题可编辑，缺失详情"）。经设计讨论，基于罗伯特·麦基《故事》的结构理论定义三层节点的结构化字段（载体、字段集、联动语义统一如下）：

- **载体**：outline.json 节点新增 `data` 字段（`Record<string, unknown>`），与实体 data 同构；按层级 schema（`OUTLINE_NODE_DATA_SCHEMAS`：volume/chapter/scene）校验。关联（人物/地点/伏笔）仍走 `relation_records`，不在 data 中重复建模。
- **字段集（麦基依据，三层各异）**：
  - 场景（= 麦基 Scene）：`goal` 场景目标/欲望（文本）；`conflict_levels` 冲突层次多选（`inner`/`personal`/`extra_personal`，麦基冲突三层次）；`value_from`/`value_to` 开场/收场价值（双文本——麦基场景定义核心「No scene that doesn't turn」）
  - 章（≈ 麦基 Sequence，推断映射）：`reversal` 章末反转（单文本，可选）；`climax_scene` 章高潮场景引用（可选）
  - 卷（≈ 麦基 Act，推断映射）：`climax_scene` 幕高潮场景引用（可选）；`inciting_scene` 激励事件落位（可选）
  - 麦基体系中无「章/卷」概念，章=Sequence、卷=Act 为推断映射（librarian 查证原书原文，2026-08）
- **引用字段宽松校验**：`climax_scene`/`inciting_scene` 引用任意场景节点 id，MVP 不校验引用范围（UI 提示建议本层内），详情页可跳转。
- **编辑不联动 Delta**：详情页编辑节点 data 直接保存，不自动生成 Delta（保持决策 9 修订「手动编辑 data 不产生 Delta 属正常行为」）；变更记录由「+ 新建变更」显式创建（S5.6 入口）。
- **主控思想 MVP 不做**：Controlling Idea（价值+原因）不进 project.json，后续迭代评估（用户裁决 2026-08）。

**为什么**：作者需要记录「这个场景要达成什么、冲突在哪、价值如何转向」——这是 AI 顾问（S6 分析工具）做小说理论层面分析的输入基础；自由文本 summary 信息密度低且无结构，AI 无法程序化感知节点叙事功能；字段集宁少勿多（每层 1-3 字段），避免过度设计。

## 决策 24：正文边界 —— 创作伴侣定位（2026-08 用户裁决）

- **工具不承载正文编辑与存储**：正文由作者在自有工具（Word/Notion 等）中书写，本工具专注大纲、设定、伏笔等结构化创作要素 + AI 顾问。
- **AI 不读取用户已写正文**：不做正文参考素材导入/粘贴（按场景或书级均不做）——AI 顾问的分析依据仅限结构化数据（大纲节点、实体、关系、Delta、伏笔）。
- **能力边界随之确定**：设定矛盾检测、节奏建议等以结构体能支撑的分析为界；正文检索、成稿导出（docx/markdown）、场景正文统计等均不做。
- **理由**：本地优先 + 轻聚焦，避免与成熟写作编辑器正面竞争；正文接入会引入大文本存储、上下文预算挤占、格式兼容与同步复杂度（YAGNI）；「AI 只基于结构提建议」与「笔始终在作者手里」的产品叙事自洽。
- **复审条件**：若用户反馈「建议缺乏正文依据」成为高频诉求，再评估按场景正文参考（届时单独立决策，含上下文预算与存储方案）。

**为什么**：正文边界是产品形态的第一性问题——做成写作环境会与 Word/Scrivener/橙瓜正面竞争并稀释「结构体先行」焦点；伴侣定位下结构化数据已足以支撑核心价值（要素管理、矛盾发现、伏笔追踪、路径推演）；决策 23 的麦基字段集正是为「无正文也可做小说理论分析」而设。

## 决策 25：项目提示词编辑 UI（2026-08 用户裁决，决策 24 后续）

创作伴侣定位（决策 24）确定后，「用户如何把自身规则、行业要求与经验注入 AI 上下文」成为核心体验问题。现状盘点（2026-08 实测）：项目 `prompt` 字段（project.json，**跟随书籍**）是唯一持久化通道，注入 system「## 项目设定」段，但**无编辑 UI**（仅 Dashboard 只读两行展示）。

- **范围（用户裁决）**：仅做「项目提示词」编辑 UI——设置页多行文本域 + 保存（`PUT /api/v1/project/config` patch `prompt`，API 已就绪）；注入机制已存在（`buildSystemBase`「## 项目设定」段），不改动。
- **否决方案（2026-08 评估）**：
  - **规则文件机制（rules.md）**：与项目提示词功能重复——同为「跟随书籍的长期规则注入」，不再引入文件机制；保持单一事实源（project.json `prompt`），避免两套注入通道并存漂移。
  - **临时指令层（决策 7 `instruction` 参数接线）**：聊天框用户消息本身即临时指令，单独字段属重复能力，不激活。
- **注入层全景（维持现状）**：内核（代码固定）→ 项目设定（project.json `prompt`，UI 可编辑）→ 聚焦（focus，动态）→ 工具清单（32 全量）→ 历史（预算内滑动窗口）。

**为什么**：「跟随书籍的项目提示词」以单一可编辑字段承载（含行业要求与写作经验，一段式自由文本）；评估过的两个扩展（规则文件、临时指令）均与现有能力重复，不做——避免双通道漂移与维护成本；若未来规则需要多主题结构化管理再单独决策。

## 决策 26：时间轴（事件实体，2026-08 用户裁决）

大纲树表达结构序（卷→章→场景），关系图表达关联，但两者都无法表达「事件发生顺序」——第 3 章的事件可以早于第 1 章末尾的事件（倒叙）、不同 POV 的时间线可以并行推进（多时间线），这是叙事创作工具的高频需求（外部调研验证：Aeon Timeline 灵活排序 / Plottr 标签筛选 / oh-story 事件锚点模式）。经设计讨论与用户裁决，中栏新增「时间轴」tab，以第 5 种实体类型承载事件与事件序：

- **功能定位**：中栏新增 tab「时间轴」（位于伏笔与回收站之间）；用户可编辑事件发生顺序（**拖拽排序为权威**）、定义时间点（自由文本 `time_label` + 可选锚定大纲节点）、给事件打标签分类。事件是独立实体，**不承载正文**（决策 24 边界，事件仅描述与锚定）。
- **存储（复用实体体系）**：新增第 5 种实体类型 `event`（id 前缀 `ev-`），复用 entities 表 / 泛型 CRUD / 回收站 / 关系体系；data 字段 = `description` / `time_label`（自由文本，**不解析、不参与排序**）/ `tags`（数组，分类筛选）——沿用决策 23 data 模式。
- **排序（拖拽为权威）**：entities 表新增 `sort_order` 列（全局事件线性序，拖拽为权威，时间标签仅展示）；**SCHEMA_VERSION 1→2**，成为 E5 迁移机制首个真实用例（`migrations/002_event_timeline.ts`：SQLite 改 CHECK 需建新表拷贝）；move 端点 `PUT /api/v1/entity/event/:id/move`（body `{order}`）。
- **锚定（关系表达）**：新增关系类型 `occurs_in`（event → outline_node，多对多）；锚定 = 关系，**无独立 chapter_anchor 字段**；倒叙 / 多时间线 / 无场景事件（章级锚定、不锚定）均可表达。
- **既有语义自动获得**：软删 / 回收站 / 导出导入 / 级联可见性随实体体系自动获得；**event 不产生 Delta**（决策 9 修订语义，编辑事件 data 不生成变更记录）。
- **UI**：列表页 `#/timeline`（拖拽排序 + 时间标签 + tags 徽标 + 标签筛选器 + 新建）；详情页 `#/timeline/:id`（字段编辑 + occurs_in 关联节点管理）。
- **AI 层（MVP 不加工具）**：时间线一致性分析、事件草案生成均不做，列入 backlog #15（触发条件 = 时间轴 MVP 上线后用户需要 AI 分析）。
- **否决方案（2026-08 评估）**：
  - **事件塞大纲节点 data**：大纲节点是「卷→章→场景」结构序，事件是跨章节的独立时间序——同一事件可关联多个章节、可倒序、可平行（多时间线），塞进节点 data 无法表达，且破坏严格三层结构语义（决策 19）。
  - **事件复用 appears_in 关系**：`appears_in` 是「实体出现于节点」的既有语义（人物/设定/地点出现在哪个场景），时间锚定需要「事件发生于此节点」的独立语义（多对多、可多锚点）；复用会使既有实体/伏笔查询语义混淆。
  - **MVP 加 AI 工具**：时间线一致性分析、事件草案生成依赖成熟的时间轴数据，MVP 阶段数据量小、用户尚未形成使用习惯——先做纯人工管理，AI 增强按 backlog #15 触发条件演进（YAGNI）。

**为什么**：时间序与结构序是两种正交的叙事维度——大纲树表达「阅读/结构顺序」，时间轴表达「事件发生顺序」，倒叙（in medias res）与多时间线（POV 分线）只能靠独立事件序表达；事件作为独立实体复用既有实体体系（泛型 CRUD / 回收站 / 关系 / 软删级联 / 导出导入）零新增机制成本；`sort_order` 拖拽排序保证「顺序 = 用户意图」的权威语义，时间标签仅展示不解析（自由文本解析成本高、易错）；`occurs_in` 以关系表达锚定，与决策 2 通用关系表一致，多对多语义下倒叙 / 多时间线 / 无场景事件自然表达；E5 迁移机制借首个真实用例（v1→v2 建新表拷贝改 CHECK）兑现决策 13「首个真实迁移条目在 SCHEMA_VERSION 提升时加入 `packages/db/src/migrations/`」的承诺。

> **修订注记（2026-08，用户反馈批次 F3/F4）——UI 形态裁决：垂直时间轴 + 时间点分组**。MVP 列表页为纯 `ul.divide-y` 纵向列表，用户实测反馈三点：① 期望「从上到下时间轴」的视觉效果（轴线 + 节点）而非列表排布；② 同一 `time_label` 的事件应视觉归组（归属于同一时间点）；③ 时间标签应更醒目。经调研（lib-1，2026-08）：shadcn 官方/社区 registry 均无 timeline 组件；独立库（react-vertical-timeline-component 预打包 CSS 硬编码、antd/MUI/Chakra/daisyUI 重依赖或整体系引入、SAP UI5 有原生分组语义但不引入）均不可直接引入 → **自实现**（约 100-150 行，零新依赖，Tailwind 4 + 现有 tokens）。最终形态：左侧垂直时间轴线 + 节点圆点；同 `time_label` 事件归入同一「时间点」组块（组标题 = 时间标签 + 计数，组内堆叠，可折叠）；组间按拖拽 `sort_order` 线性序（**拖拽仍为权威，不因视觉重构改变**）；时间标签样式提升为醒目（`text-sm font-medium text-foreground` + 主题色点缀）。拆卡实施：F3 = 垂直时间轴本体（轴线 + 节点 + 事件行），F4 = 同标签归组。视觉全走 tokens（禁硬编码色类，oracle 审核红线）。

> **修订注记（2026-08，用户反馈批次 F9）——LLM 识别时间标签语义排序（提案确认）**。MVP 语义：`time_label` 仅展示、**不解析不排序**（拖拽 `sort_order` 为权威）。用户需求：时间标签排序由 LLM 识别并产生提案，用户确认后采用。设计裁决（延续决策 14 权限分级 + 决策 26「拖拽为权威」的演进）：**新增提案类工具 `propose_reorder_events`**——AI 读取事件列表（name + time_label）→ LLM 语义理解时间先后 → 产出有序事件 id 序列 → 提案卡（含顺序变化预览）→ 用户确认 → Tool Executor 校验 references（存在性 + `updated_at` 快照，决策 14）后按序重排 `sort_order`。**`sort_order` 权威语义不变**：拖拽仍可直接改序，AI 排序经提案确认后落为同一 `sort_order` 线性序（用户最终决策者，决策 14/24 边界）。tool_result 只返回 `{ proposal_id, summary }`（防 LLM 误以为已生效重复提案）；前端时间轴页提供「AI 排序」入口（注入聊天引导 LLM 调用该工具）；与 backlog #15（时间线一致性分析）是不同能力——#15 是只读分析，本项是排序写提案。

> **修订注记（2026-08，用户反馈批次 G2）——时间标签点实体化（决策 26 重大修订，已确认设计）**。F1-F9 上线后用户实测反馈：① 时间轴按 time_label 分组后，组块整块拖拽失去单条事件拖拽能力；② 时间标签与事件绑定死，无法「先定义时间点、再挂载事件」。用户裁决（2026-08）：**时间标签从事件剥离为独立实体**——时间轴数据项分两类：**时间标签点（timepoint）** 与 **事件（event）**。设计决策（全部经用户确认）：
> - **新实体类型 `timepoint`**（id 前缀 `tp-`，第 6 种实体，复用实体体系：泛型 CRUD / 回收站 / 软删 / 关系 / 导出导入零新增机制成本）；`name` = 时间标签文本（如「第二天黄昏」，**可重命名**），data 空（无专属字段，YAGNI）；`sort_order` 列承载时间点序（与 event 同列、各类型内线性）。
> - **挂载关系 = 通用关系表**：新增关系类型 `occurs_at`（timepoint → event，**1:n**——一个事件至多挂一个时间点，服务端建关系时校验；事件无挂载 = 未挂载，等价旧「未标注时间」）。
> - **双独立线性序**：timepoint.sort_order = 组间顺序（拖拽时间点改它，**其下事件序不变**——整组移动不动内部）；event.sort_order = 组内排序键（渲染时组内按事件全局序投影排序，跨组拖拽后服务端重排全数组 0..n-1）。两组序完全正交。
> - **跨组拖拽即改挂载**：单条事件拖到另一时间点区块 → 自动改挂载（旧 occurs_at 移除 + 新 occurs_at 建立 + 全局序插入目标位置），拖拽结束一次性事务提交，**无确认弹窗**。
> - **旧数据迁移（SCHEMA_VERSION 2→3）**：现有 `event.data.time_label` 按值聚合——同名 time_label 合并为同一 timepoint + 建 occurs_at 关系 + 从 event.data 移除 time_label；无 time_label 事件不建关系（= 未挂载）。E5 增量迁移事务内完成、失败回滚。
> - **未挂载兜底区**：无 occurs_at 事件归入列表末尾「未挂载」区（按事件序平铺，样式弱化），可直接拖拽到任一时间点完成挂载。
> - **AI 排序适配**：**移除 `propose_reorder_events`**（事件无时间标签无法语义排序）；**新增 `propose_reorder_timepoints`**（LLM 按时间标签语义排序时间点，提案确认后重排 timepoint.sort_order）。
> - **新建交互（双入口 + 组内新建）**：header「+ 新建时间点」（定义时间标签文本）；每个时间点组块内「+ 新建事件」（自动挂载该时间点）；顶部「+ 新建事件」保留为不挂载（入未挂载区）；组标题可重命名。
> - **删除语义（软删 + 事件脱钩）**：软删 timepoint（进回收站可还原）→ 其下事件 occurs_at 级联软删 → 事件变未挂载（事件本身不删），与决策 12 级联软删语义一致。

## 决策 27：自动备份与恢复（2026-08 用户裁决，决策 26 后续）

E1 手动导出/导入（zip 备份包）已具备，但备份依赖用户手动操作、无历史版本管理。用户需求（2026-08）：自动备份 + 加载备份（文件导入 / 历史自动备份列表二选一）+ 设置备份频率。经设计讨论与用户裁决：

- **唯一 key = project_id**：导入/加载备份时，以 zip 内 `project.json` 的 id 与书架已有项目比对——**匹配 → 覆盖恢复**；**不匹配 → 导入为新书**（原 E2 语义保留）。不用书名做 key（可改、可重复）；覆盖时**保留当前项目 id**（`chat_messages` 会话按 project_id 隔离，换 id 即断连会话历史，决策 18）；name/prompt/三文件数据随备份替换。
- **同名（id 不同）不再 409**（原 `PROJECT_ALREADY_EXISTS` 与 create 同语义）：导入时若书名与书架冲突，由用户二选一——**重命名导入**（输入新书名，预填 `<书名> (2)`）或**保持原样**（同名并存，目录自动去重为 `books/<书名> (N)/`，project.json 内部 name 同步为去重名——维持「目录名 = 书名」不变式，书架显示无歧义）。
- **重命名书名能力**：书架书行 [重命名] 图标按钮（H3 起直接展示，不收 ⋯ 菜单）→ `POST /api/v1/project/rename { name }`（书名校验同创建规则 → 目标目录可用性，冲突 409 → **原子移动目录 + 更新 project.json name**，失败回滚）；当前打开的书改名时服务端同步更新内部项目路径引用，会话按 id 不受影响。这是「同名可并存」的自然配套（两个同名书可后续重命名区分）。
- **备份频率跟随书籍**：project.json 新增**可选字段** `backup_frequency_minutes: number | null`（缺省 = 10；null / 0 = 关闭；选项固定为关闭 / 5 / 10 / 15 / 30 / 60 分钟，MVP 不做自定义分钟数）；与 prompt（决策 25）同一哲学——跟随书籍、每项目独立。**不升 schema_version**（可选字段宽松读取，旧程序按字段 patch 不丢新字段）。
- **自动备份（服务端定时器）**：服务运行期间按频率定时检查，**仅当三文件（outline.json / data.db / project.json）有任一 mtime 晚于「上次备份时刻」才生成新备份**（上次备份时刻 = `.backups/` 中最新备份的时间戳，无状态、服务重启不丢；无变更跳过，不产生垃圾备份）。备份文件格式**复用 E1 zip**（三文件 + wal_checkpoint 完整快照）。**修订注记（2026-08，F2 修复）**：变更判定补查 `data.db-wal` 伴生文件——data.db 走 WAL 模式（`journal_mode = WAL`），普通写事务只追加 `-wal`、主文件 mtime 不变，仅 stat 三主文件会漏检全部 data.db 写（实体/关系/Delta/聊天/时间轴）；wal 存在且 mtime 晚于上次备份时刻 → 有变更；**wal 缺失视为无变更**（无未 checkpoint 写，与主文件缺失「视为变更」的防御语义不同，防每次 tick 误备份）。
- **备份存储与保留**：项目目录内 `.backups/` 子目录（随书籍移动自然携带）；文件名时间戳命名（如 `20260813-101500.zip`）；**每项目保留最近 20 份，超出删除最旧**。
- **加载保护**：加载备份 / 导入覆盖前，服务端**自动将当前状态打包为快照**存入 `.backups/`（复用备份管道，同保留策略自然淘汰）——误操作/选错备份永远有后悔药；随后**原子替换三文件**；前端刷新 config/outline/会话。restore 的 data.db 校验与 import 同款（user_version 三态分流，E4/E5 语义，绝不静默重建）。
- **备份/列表/频率均项目级（跟随书籍）**，不做书架级备份——书架是创作根的目录集合，备份粒度到书。

**为什么**：备份的直觉语义是「恢复到备份时点」——以 project_id 匹配实现「同名覆盖、异名新书」的智能分流，覆盖恢复与导入新书统一为一条管道；保留当前项目 id 保护会话历史不因恢复而断连；频率跟随书籍使部署场景多项目独立（与 prompt 同一哲学）；「有变更才备份」避免闲置期垃圾备份；覆盖前自动快照把误操作风险降至最低（本地单用户工具，数据安全即产品承诺「数据主权归用户」的延伸）。

## 决策 28：备份命名增强 —— 毫秒精度 + 手动备份自定义名称（2026-08 用户反馈，决策 27 后续）

B2 上线后用户反馈两点命名痛点：① 备份文件名时间精度不足——快速连续备份（手动 + 覆盖前快照连发）在列表里几乎无法区分，设置页时间显示只到分钟；② 手动备份不支持自定义名称，无法表达备份意图（如「定稿前」「交编辑」）。经设计讨论与用户裁决：

- **新文件名格式（毫秒精度）**：`<YYYYMMDD-HHmmssSSS>.zip`（本地时区 17 位时间戳，如 `20260813-101530123.zip`）；**旧秒级格式 `<YYYYMMDD-HHmmss>.zip` 继续兼容解析**（历史备份仍可列出/恢复/参与保留策略，不迁移不重命名）。同毫秒冲突（理论罕见）按 +1 毫秒循环去重，保持格式契约可解析。
- **手动备份自定义名称**：`POST /api/v1/project/backup` 请求体新增**可选** `name` 字段（snake_case）；带名称的文件名 = `<YYYYMMDD-HHmmssSSS>-<名称>.zip`。名称规则：trim 后 1-30 字符（`MAX_BACKUP_NAME_LENGTH`），禁路径分隔符（/\\）与保留字符（`:*?"<>|`）与控制字符，禁纯点（`.`/`..`），自动剥离尾部 `.zip`；非法 → 400 `VALIDATION_ERROR`。**校验收敛在 shared `sanitizeBackupName` 纯函数**（服务端唯一执行点 = `writeBackup`，路由层 zod schema 仅做形状校验）——自动备份 / 覆盖前快照不传名称，文件名保持纯时间戳。
- **列表与恢复兼容**：`GET /project/backups` 响应项新增可选 `name` 字段（由文件名解析，旧备份无此字段）；restore 白名单按新 parse 兼容三类文件名（新格式带/不带名称 + 旧秒级格式），路径穿越防护语义不变（时间戳部分 ^$ 锚定纯数字 + 名称部分拒绝 /\\）。
- **变更判定容差不变**：上次备份时刻从文件名解析（毫秒精度），`BACKUP_CHANGE_TOLERANCE_MS = 1s` 保留——粗粒度 mtime 文件系统（如 FAT/exFAT 2s 粒度）下容差是必要防御，不因精度提升收紧。
- **UI 配套**：设置页「立即备份」旁新增「备份名称（可选）」输入框（maxLength 30，成功后清空）；历史列表行显示自定义名称（时间置灰 + 名称强调）；**时间显示补秒**（`MM-DD HH:mm:ss` / 跨年 `YY-MM-DD HH:mm:ss`）——否则同分钟内多次备份在界面上依旧无法区分，毫秒级文件名失去意义。

**为什么**：毫秒精度让「备份身份」唯一（同秒连发不再 +1s 伪造时间序），旧格式兼容保证既有用户 `.backups/` 零迁移；自定义名称满足「备份 = 有意图的快照」的使用直觉（E1 导出是文件、B2 备份是版本，版本需要可读标签）；名称只进文件名不进 zip 内容——保持 E1 导出包三文件契约不动（导入/恢复管道零改动）；sanitize 收敛单点避免路由层各自校验漂移；时间显示补秒是让精度提升在 UI 上可感知的最小配套。

## 决策 29：备份类型标签 + 备份重命名（2026-08 用户反馈，决策 28 后续）

B2.5 上线后用户反馈两点体验痛点：① **手动/自动备份在列表无法区分**——手动备份不填名称时（多数用户直接点「立即备份」）文件名与自动备份同为纯时间戳，`GET /backups` 无类型字段，列表只能看到时间；② **备份创建后不能改名**——忘填名称、意图变化（如「定稿前」→「交编辑」）只能删除重建。用户需求（2026-08）：界面用简单标签区分手动/自动备份；备份列表支持重命名，行显示格式「时间 + 简单标签 + 用户自定义命名」。经设计讨论与用户裁决：

- **类型标签持久化 = 文件名编码（无状态，决策 27「文件名即事实来源」哲学延续）**——文件名格式扩展为 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`，kind 段为单字母 `m`（手动）/ `a`（自动带名称）：
  - 自动备份 / 覆盖前快照：纯时间戳 `<YYYYMMDD-HHmmssSSS>.zip`（现状不变，不输出标记段）
  - 手动备份：`<YYYYMMDD-HHmmssSSS>-m.zip`（无名称）或 `<YYYYMMDD-HHmmssSSS>-m-<名称>.zip`——**无名称手动备份从此可与自动备份可靠区分**
  - 自动备份重命名后：`<YYYYMMDD-HHmmssSSS>-a-<名称>.zip`（kind 段使「重命名后类型不漂移」）
  - **兼容解析不迁移**：旧秒级 `<YYYYMMDD-HHmmss>.zip` → auto；旧带名称无 kind 段 `<YYYYMMDD-HHmmssSSS>-<名称>.zip` → manual；纯时间戳 → auto。已知微小歧义：旧「名称恰为单字母 a/m 或以 a-/m- 开头」的带名称备份（如 `<时间戳>-m.zip`、`<时间戳>-m-交稿前.zip`）会按新格式解析为 kind 标记（前者 auto 无名称、后者 manual + 截断前缀的名称）——B2.5 上线窗口极短、概率极低，接受并注释说明。
- **kind 不随重命名改变**：重命名只改名称段，时间戳与来源标签（手动/自动）保持——「标签 = 备份来源」语义固定，与名称正交。
- **契约**：`GET /project/backups` 响应项新增**必填** `kind: "auto" | "manual"`（shared `BackupKind`，文件名解析）；`POST /project/backup` 手动触发 → `kind: "manual"`（文件名落 `-m` 段，名称可选）；**新增 `POST /project/backup/rename`** `{ fileName, name? }`——name 非空 → sanitize（规则同决策 28）→ 原子改名（同目录 rename）为 `<时间戳>[-kind][-名称].zip`；name 空/缺省 → 清除名称段（manual 保留 `-m` 标记，auto 回到纯时间戳）；同文件同名称 → 幂等直接返回；**目标文件名已存在 → 409 `BACKUP_TARGET_EXISTS`（rename 前 existsSync 检查，杜绝静默覆盖丢失备份）**；404 备份不存在 / 400 名称非法。**旧格式文件改名时顺带规范化**：旧秒级 → 毫秒补 `000`、旧带名称无 kind 段 → 补 kind 段（一次性迁移语义，测试钉死）。名称只进文件名不进 zip 内容（决策 28 语义延续，导入/恢复管道零改动）。
- **UI 配套**：设置页备份列表行显示「时间 + 简单标签（自动/手动）+ 自定义名称 + 大小 + [重命名] [加载]」，格式 `08-14 13:12:59 自动 定稿`；重命名行内编辑（铅笔/重命名按钮 → 行内输入框预填当前名称，Enter/确认按钮提交、Esc 或失焦取消、成功后刷新列表；提交中禁用输入，失败行内提示保持编辑态）；恢复确认 Dialog 同步展示标签。

**为什么**：类型必须可靠持久化才能支撑标签——「带名称段 = 手动」的推断在「手动无名称」与「自动备份重命名」两个场景失真，故选择文件名编码（无状态、无同步/脏数据问题，与决策 27 无状态哲学一致；旁路元数据文件方案因引入状态文件与脱钩风险被否决）；`-m`/`-a` 单字母段兼顾文件名字面简洁与解析确定性，旧格式全部兼容保证既有 `.backups/` 零迁移；重命名保持 kind 使「标签 = 来源」语义稳定，用户重命名自动备份后不会误标为手动；重命名即物理改名保持「文件名即事实」单一来源，restore 白名单/保留策略/变更判定经统一 parse 自动兼容。

## 决策 30：设定层级 = belongs_to 关系，data.parent_id 废弃（2026-08 用户裁决，决策 23 后续）

用户反馈（2026-08 批次四）：① 设定详情页「上级设定」是裸文本输入（须手填实体 id），填了不建关系、关联面板无动于衷，与「新建关联」完全是两套互不感知的机制（困惑点）；② `parent_id` 存在 entities 表 data 列 JSON 内，大量设定时父子查询需全表扫描 + 逐行 JSON.parse，无索引、有性能风险；③ 同一语义不愿维护两套数据结构；④ 层级系统用 `belongs_to` 表达父子即可。经设计讨论与用户逐点裁决：

- **层级 = belongs_to 关系（setting → setting）**：方向语义与既有「belongs_to 所属 | 人物→设定」自洽——**子设定 belongs_to 父设定**（「子属于父」）。查询父 = `belongs_to` 且 `target_id=该设定` 的来源端；查询子 = `belongs_to` 且 `source_id=该设定` 的目标端；改父 = 删旧边 + 建新边。读写均走 `relation_records` 索引（`idx_relation_source`/`idx_relation_target`），数量级优于扫 data JSON。
- **`data.parent_id` 废弃（不写迁移）**：不再读写；`settingDataSchema` 移除定义（`.passthrough()` 容错旧数据字段残留，无害）；客户端字段配置移除（详情页/新建不再渲染）；AI 一致性工具 R5 移除 setting 检查（location 的 parent_id 保留——不在本决策范围，同样问题另行立项）。**开发期无真实数据，不写 004 迁移**（YAGNI；有真实数据需求时再评估迁移）。
- **服务端校验（POST /relation 新增分支）**：`relation_type=belongs_to` 且两端均为 setting 时——**禁自指**（target ≠ source）、**防环**（新父沿祖先链向上不得经过该子设定），违规 400 `VALIDATION_ERROR` + 中文信息。通用 `belongs_to`（如人物→设定）不受影响。
- **性能方案（用户第 4 点）**：防环校验用**层级邻接表**——db 层一次性 SELECT 全量 setting→setting belongs_to 边（带索引、O(N)）构建 `child→parent` Map，每次写操作构建一次、写后失效（惰性），祖先链查询 O(深度)。设定父选择器候选走既有 `listEntities(setting)`（弹层搜索选择器，防抖搜索 + limit 上限），不新增端点。
- **UI**：详情页「关联」面板新增**「层级」区块**（父设定 / 子设定分区展示，可跳转；修改上级 = 删旧建新复合操作）；新建行「上级设定（选填）」弹层搜索选择器；设定树视图（I4）按 belongs_to 构建层级树。

**为什么**：一处语义一处存储（关系表有索引、有端点校验、有回收站级联，层级天然复用）；防环/自指校验集中在关系创建点，杜绝 data 字段的无约束挂载；UI 层把「层级」与「关联列表」分区呈现，消除「填了上级设定关联里看不到」的脱节困惑；废弃不迁移是把迁移成本用于真实数据需求而非开发期遗留字段。

## 决策 31：设定分类统一为 tags 标签，data.category 废弃（2026-08 用户裁决，批次五）

批次四将设定层级改为 belongs_to 关系后，用户进一步审视设定页：`data.category`（自由文本单值分类）与 `data.rules[]`（标签数组）职责重叠——用户裁决（2026-08 批次五）：**设定分类统一由 `rules[]` 标签承担，category 废弃**；列表页筛选复用 tags 机制（服务端 `matchDataFilters.tags` 已具备包含匹配），不新增 category 过滤。

- **`data.category` 废弃**（同决策 30 parent_id 模式）：不再读写；`settingDataSchema` 移除定义（`.passthrough()` 容错旧数据残留）；UI 全链移除——列表摘要列由「类别」改为「标签」（`rules` 前 3 个）、新建行不再有类别输入（仅名称 + 上级设定）、详情页基础信息移除类别字段；Delta 字段清单同步。**不写迁移**（开发期无真实数据，旧 category 残留无害）。
- **标签筛选**：`GET /api/v1/entity/setting` 新增可选 `tag` 参数（单标签包含匹配，校验 `Array.isArray(data.rules) && rules.includes(tag)`，走既有 `matchDataFilters.tags` 机制）——**不改表结构、不新增过滤字段**，仅把 S6.3 工具下沉的内部能力挂到 REST。前端列表页顶部「标签 ▾」下拉（聚合现有设定 rules 标签集合 + 全部），与搜索/排序/分页组合。时间轴事件页已有同款标签筛选（决策 26/F3），不重复实现。
- **自动完成提示（浏览器原生 datalist，用户诉求"谷歌浏览器输入行为"）**：按类型聚合现有数据动态生成 `<datalist>` 候选——新建行名称（聚合已有名称）、首字段（人物角色/地点类型等聚合现有值）、设定详情规则标签（聚合全量 tags）、伏笔类别（`HOOK_CATEGORIES` 枚举）；时间轴沿用既有 TagSuggest（F8），不重复。

**为什么**：分类与标签是同一语义的两套表达（YAGNI 取一）——标签是数组、天然支持多选分类与既有筛选管道，category 单值与之重叠且无筛选能力；按类型聚合的 datalist 让输入提示随数据自然生长（多写即多提示），零额外状态；tag 筛选零表结构改动（复用内部 filters 管道）。

**K2 修订（2026-08 用户复核）**：J1 把 `data.rules` 直接复用为分类标签（UI 显示「标签」）造成字段名与语义错位（rules 原名「规则条款」），用户裁决：**分类统一字段 `data.tags: string[]`（前后端同名，UI 显示「标签」），`data.rules: string[]` 恢复「规则条款」语义（仅设定详情页编辑）**；新增 **004 迁移**（SCHEMA_VERSION 4，无 DDL 仅 data JSON）把旧 rules 分类值复制到 data.tags 并移除 rules（用户裁决旧数据视为分类标签）；标签编辑增加**快捷选择**（详情页展示既有标签 chips，点击追加去重）+ datalist 自动补全；db 摘要/筛选/统计统一读 data.tags（matchDataFilters 移除按类型路由——setting 与 event 同字段语义）。

## 决策 32：设定列表上级设定筛选 —— 递归子树（2026-08 用户需求，决策 30/31 后续）

用户需求（2026-08）：设定列表（实体关系页「设定」tab）需要按上级设定筛选——选择某一上级设定后，只显示该上级设定下的设定。用户裁决筛选范围：**包含所有后代（递归子树）**——一级一级查看太过繁琐。

- **契约**：`GET /api/v1/entity/setting` 新增可选查询参数 `parent_id`（仅 setting 类型生效；其他类型传入忽略）。匹配语义 = 命中实体在设定层级树（belongs_to，决策 30）中**直接或间接属于**该上级（递归子树，**不含上级自身**）。
- **实现复用「只读层级边结构」**：不新增查询端点、不扫 data JSON——复用 db 层既有 `listSettingHierarchyEdges(db)`（全量 setting→setting `belongs_to` 边，带索引 O(N)，两端未软删、边未删），构建 `childId → parentId[]` 邻接表后 **DFS 收集全部后代 id 集合**（防环守卫：结果 Set 去重，数据异常成环不死循环）；列表走 db `listEntities` 既有 **JS 过滤路径**（与 `filters` 同款「全量候选行 + JS 过滤 + JS 分页」）——total 为过滤后总数，分页正确。
- **组合过滤（AND）**：与搜索 `q`、标签筛选 `tag`、排序、分页叠加；软删联动天然正确（`listSettingHierarchyEdges` 已过滤软删端点，软删设定不再命中其父筛选）。`parent_id` 指向不存在的设定（含已软删）→ 空结果（宽松语义，同 tag 无匹配，不 404——列表过滤参数不因引用失效而报错）。
- **UI**：设定列表排序行「上级设定 ▾」下拉（候选 = 全部设定按名称排序 +「全部」重置项；与标签筛选并列；切换 tab/类型重置）；空态文案区分「《…》下暂无设定」；筛选后以下设定为根的子树一览。设定树视图（I4）职责不变（全量层级浏览），列表筛选做定点下钻，两者互补不重叠。

**为什么**：列表分页为服务端权威，递归子树过滤必须在服务端完成（客户端只过滤当前页会破坏分页）——复用既有层级边结构即可 O(N) 收集后代，零表结构改动、零新端点；决策 30 的「关系表带索引」性能方案（对比扫 data JSON）在此场景同样受益；宽松空结果与 tag 筛选语义一致（列表过滤参数是组合条件，非资源引用）。

## 决策 33：画布页移除（2026-08 用户裁决，批次八）

用户需求（2026-08）：删除中栏「画布」页并清理所有相关代码——当前画布页毫无意义，1000 章后难以显示。

- **移除范围（前端 + 文档）**：`pages/Canvas.tsx`、`pages/canvas.test.tsx`、`lib/canvas.ts`、`lib/canvas.test.ts`（画布布局/连线解析/坐标持久化等全部画布专属代码）、TabBar「画布」tab、`main.tsx` canvas 路由分支、`use-route.ts` `KNOWN_ROUTE_SEGMENTS` 中 `canvas` 段（未知 hash 回退 `#/` 兜底）；`doc/ui/pages/canvas.md` 标注废弃；layout.md 路由表/TabBar/架构图同步；Outline 页头部注释「画布投影」提法修订。
- **数据能力保留（决策 10 不变）**：`plot_edge` 关系类型与接口能力（`POST/GET/DELETE /relation`）不受影响——大纲节点间的剧情连线数据可继续经关系接口读写（无 UI 入口），服务端 schema 零改动；大纲/时间轴等页面与 `plot_edge` 无关的代码不动。
- **localStorage 残留**：既有用户画布坐标（`ai-editor:canvas:{project_id}`）不再被读取，为无害残留，不清理、不做迁移。

**为什么**：画布是同一大纲数据的可视化投影，随章节量增大（1000 章）自动布局/拖拽失去可用性，维护成本高于价值；删除是纯前端范围变更（决策 10 的数据模型与接口均为通用关系能力，不属于画布专属），因此不做数据迁移、不破坏 `plot_edge` 兼容性（历史数据/API 消费者不受影响）。

## 决策 34：LLM 引擎换核 —— 引入 pi-ai 替换自研 llm 层（2026-08 用户裁决，批次九）

用户需求（2026-08）：不自己维护复杂 LLM 调用接口（手写 SSE 解码/流式 tool_call 累积/错误归一化），引入 pi 生态的 `@earendil-works/pi-ai`（统一多提供商 LLM API，支持 DeepSeek/OpenAI/Anthropic/Google 等 20+ 厂商）直接使用其接口。经调研与逐点确认：

- **集成形态＝方案 A（llm 包保留对外契约、内部换引擎）**：llm 包对外接口（`chatStream` 事件流 / `LLMStreamEvent` / `LLMError` / `LLMUsage` / `LLMToolDefinition`）签名不变，内部实现从手写 fetch/SSE 替换为 pi-ai 的 `models.stream`——agent 层（run.ts 的 produce 注入）、server 层（chat 路由的 createRealProduce / 调试日志装饰器）、shared 契约、前端零改动。**用户诉求达成**：手写 SSE 解码/splitSSEFrames/流式 tool_call 累积/usage 解析/错误 body 归一化（client.ts 约 300 行）整体删除，换为声明式事件转发 adapter（约 200 行）。
- **消息模型**：ai-editor 的 `LLMMessage`（OpenAI wire 格式：system/user/assistant+tool_calls/tool+tool_call_id）与 pi-ai 的 Context（content blocks 数组 + toolResult 独立消息）是两套结构——转换不可避免，但方案 A 把转换压成**单向有界的声明式 adapter**：DB 行 → pi-ai Context（入站一处构建）+ 流事件转发（出站纯事件映射），而不是方案 B 的双向结构转换摊在 agent/DB/前端三层。storage 对比结论：pi 的 JSONL 文件会话存储（按 cwd 目录隔离 + 每会话一文件 + parentSession 会话树）支持多项目多会话，但它是「文件枚举 + 读元数据」级别的管理，没有 ai-editor 需要的 SQL 关系查询（按 project_id 隔离、会话摘要聚合、按条裁剪重组）——chat_messages 表（决策 18）保留不动。
- **适配映射（实现要点）**：
  - 消息：system→Context.systemPrompt；user→UserMessage；assistant→AssistantMessage（tool_calls→ToolCall 块）；tool→ToolResultMessage（content 纯文本块）
  - 事件：text_delta→text；toolcall_end→tool_call（id/name/arguments 完整对象 + rawArguments）；done(带 usage)→finish+done；error→error（归一化）
  - usage：pi-ai `input` 不含缓存（input = prompt-cacheRead-cacheWrite，源码 openai-completions.ts 1202 行）→ `prompt_tokens = input+cacheRead+cacheWrite`（= DeepSeek 原生口径）、`completion_tokens = output`、`total = totalTokens`
  - 错误：openai-completions 用官方 openai SDK，`normalizeProviderError` 会把 HTTP status + body JSON 折入 errorMessage；adapter 在流开始时的 `onResponse` 回调记录 status 结合 errorMessage 关键词恢复 `LLMError.status/code`——`classifyLLMError`（决策 15 分类语义）原逻辑不变
  - 工具 schema：LLMToolDefinition.parameters 是 JSON Schema 对象，pi-ai 的 Tool.parameters 是 TypeBox TSchema 但发送层直接透传（`parameters as any`，源码 1173 行）；adapter 原样映射 + TS 断言；`validateToolCall` 不调用（ai-editor 的 executor 自己用 zod 校验，决策 14 语义不变）
  - 思考（thinking）流：MVP 不展示思考过程（YAGNI），流事件中忽略 thinking_start/delta/end，仅做思考强度参数控制（reasoning: minimal/low/medium/high 等）
- **key 管理（决策 17 不变）**：pi-ai 的 DeepSeek provider 默认 `envApiKeyAuth(["DEEPSEEK_API_KEY"])`（环境变量优先语义与现状一致）；用户级 `~/.ai-editor/config.json` 的 api_key 通过自定义 `auth.resolve` 桥接（创建 provider 时注入 effectiveApiKey 逻辑）——key 依然不进项目文件。
- **保留**：`retry.ts`（决策 15 重试语义，pi-ai 无内置重试）、`token.ts`（决策 6 滑动窗口估算 + 裁剪预算）、AbortSignal 四层穿透（决策 16，pi-ai 的 stream option 支持 signal）。
- **新增接口**：`getAvailableModels(): ModelInfo[]`（模型目录：id/提供商标识/contextWindow/maxTokens/reasoning 支持）——支撑需求 3 的模型选择下拉与上下文占用显示的分母，是 llm 包对外契约的向后兼容增量（不影响现有合约）。
- **依赖变更**：llm 包新增依赖 `@earendil-works/pi-ai`（可 tree-shaking 的子路径 `providers/deepseek` 注册），发布链路 6 包不变（新依赖从 npm registry 拉取）——**架构约束修订**：llm 包此前的「零依赖/lib 仅 ES2022/types 空」硬约束因引入 pi-ai 放宽（pi-ai 自带类型声明），写入 architecture.md 依赖声明修订。

**为什么**：LLM 传输层是纯机械工作（SSE 解码/流式累积/usage 解析）不属于产品核心（对话组织/权限/提案才是核心），外包给成熟维护的 pi-ai 换开发速度与多模型演进空间；保留 llm 包外壳+单向 adapter 是标准防腐层——上层契约稳定、测试面收窄到 llm 包单点、pi-ai 快速演进被隔离在 llm 包内；成本仅剩一次性的 adapter 编写与测试重写。

## 决策 35：工具调用核查与中栏 AI 集成演进（2026-08 用户裁决，批次九）

核查结论（现状盘点）：工具调用链已完整闭环（zod schema → JSON Schema → LLMToolDefinition → pi-ai 透传 → executor 调度 → zod 校验 → 执行 → 结构化 tool_result），三档权限模型（自动/提案/执行）与 pi-ai 的单色执行模型兼容（pi 的工具无权限概念、全靠调用方控制；executor 自研不依赖 pi-ai 的 validateToolCall）；中栏 6 个 tab 中仅时间轴有页面内 AI 入口（AI 排序按钮），其余页面 AI 能力全部集中在右栏聊天对话驱动。用户需求（2026-08）：中栏主要功能如何跟 LLM 集成与演进。经讨论确认：

- **入口模式＝集中式（InfoBar 统一入口 + 页面焦点上报）**：
  - **「问 AI」入口放 InfoBar（中栏统一头部，全 tab 常驻）**——与现有「刷新数据」按钮同构（全局工具条上的常驻入口），不侵入各页面结构：页面增删改不碰按钮。
  - **页面只上报焦点状态**：页面挂载/选中变化时写入 ui store `currentFocus`（focus_entity_type/focus_entity_id/focus_node_id）；新增页面只加一行上报（可选，不报即无焦点语义），删页面焦点自然消失——零耦合。
  - 点击「问 AI」→ 读 currentFocus → 写入 chat store focusContext → 右栏小条显示——**继续当前会话**（不自动开新会话，params 的一致性优先心智，决策 22「一项目一会话」；用户想隔离话题时右栏「+ 新会话」是主动入口）。
- **页面业务按钮范本**：时间轴「AI 排序」是页面特有操作的业务按钮（留在页内，注入预设指令触发 propose_reorder_timepoints 走提案确认）——通用「带上下文问 AI」在外壳 InfoBar，页面特有 AI 操作按需增补（复刻时间轴模式）。
- **工具目录随数据源演进**：新数据源（决策 36 参考资料）落地时同步扩展工具目录（search 查询 + propose 提案）作为演进落地场景；不新增「页面 AI 结果面板」形态（与「AI 是创作顾问、形态保留对话式」的产品心智一致，YAGNI）。

**为什么**：集中式入口消除页面结构耦合（新增页面零外壳改动）且符合「全局工具条」的既有架构（刷新按钮先例）；焦点上报把「页面在关注什么」语义化暴露给聊天层，是较低成本的高价值演进；继续当前会话保持对话连贯性，新会话归用户主动行为。

## 决策 36：参考资料页（第 7 种实体类型 reference，2026-08 用户裁决，批次九）

用户需求（2026-08）：中栏新增「参考资料」tab（位置在时间轴之后、回收站之前），存放创作参考素材（书籍摘抄/灵感记录/写作理论/设定参考）并供 LLM 读取参考、写入记录。经设计讨论：

- **定位边界（先决确认）**：参考资料 = **外部素材/灵感笔记（非本书正文）**——AI 读取不违反决策 24（正文边界）；本书正文片段暂不开放（决策 24 复审条件依然生效：若「建议缺乏正文依据」成高频诉求再评估按场景正文参考，单独决策）。
- **实体设计（第 7 种实体类型 reference，id 前缀 `ref-`）**：复用 entities 表（泛型 CRUD/软删/回收站/标签筛选/搜索/分页自动获得，event/timepoint 先例）：
  - `name`：标题（必填）
  - `data.type`：分类枚举 `material`（素材摘抄）/ `inspiration`（灵感记录）/ `theory`（写作理论）/ `reference`（设定参考），缺省 `material`（分类是单枚枚举，与多选标签互补）
  - `data.content`：内容全文（长文本无上限，存 data JSON；SQLite TEXT 上限 1GB 无压力）
  - `data.source`：来源（URL/书名/作者，可选，展示为链接或文本）
  - `data.tags`：标签数组（决策 31 统一字段，复用既有标签筛选管道与 datalist 自动完成）
  - `sort_order` 恒 NULL（不参与时间轴线性序）；不开放关联（YAGNI：参考资料为独立素材库，relation 关联留待有真实需求再扩）；不加 custom_fields
- **Schema 演进**：SCHEMA_VERSION 4→5 迁移（entities 表 type CHECK 扩入 `'reference'`，走 002/003 同款「建新表拷贝四步」迁移；无数据搬移，仅 DDL）。
- **LLM 集成（读取参考 + 写入记录）**：
  - 读取：新增自动工具 `search_references(query)`（标题+tags 关键词搜索，返回摘要列表）+ 详情复用 get_entity 的 reference 分支——AI 不知道书里有哪些参考资料时先搜索再按需取全文（决策 6 分层策略：不主动注入聚焦层，靠工具按需拉取保护 token 预算）
  - 写记录：新增提案工具 `propose_create_reference(name, type, content, source?, tags?)`——AI 读到灵感/素材后建议保存，提案卡预览（标题+内容摘要+标签）→ 用户确认 → executor 写入实体（决策 14 提案仅内存 + 快照重校验 + 404/409 语义原样延续）
  - 上下文配合：参考资料不主动注入聚焦层（token 预算保护），可选注入开关留待需求 3 上下文占用显示上线后评估。
- **页面（需求 4 承接，批次九 C）**：路由 `#/references`（列表：类型徽标+标签筛选+搜索+分页+摘要截断 120 字）/ `#/references/:id`（详情：全文阅读+编辑+来源+标签管理+软删入口）；TabBar 新增「参考资料」tab（时间轴后、回收站前，路由表与 KNOWN_ROUTE_SEGMENTS 同步）。

**为什么**：参考资料是创作顾问的「知识库」定位的自然延伸（作者把外部素材结构化沉淀，AI 基于它们提建议），既填补「AI 建议缺乏依据」的短板又未突破正文边界；复用实体体系与标签/软删/CRUD 管道零新增机制成本（决策 26 已验证先例）；AI 读写走既有工具分级（自动查询 + 提案写入）保持「笔在用户手里」的产品叙事。

## 决策 37：大纲交互优化（2026-08 用户裁决，批次十）

用户反馈（2026-08 批次十）：大纲页行级操作按钮过多——每行「详情」「＋新建」按钮占用行宽、视觉噪音大；新建子级需点按钮再选层级，操作路径长。经设计讨论与用户裁决，大纲行级交互收敛为「键盘 + 双击 + 行内编辑」模式：

- **移除行级「详情」「＋新建」按钮**：行级只保留删除按钮（H3 起直接展示，不收 ⋯ 菜单）；「详情」入口改为双击节点，「新建子级」入口改为选中节点后按 Enter。
- **新建子级 = 选中节点后按 Enter**：选中节点（单击选中）后按 Enter → 就地输入行出现在该节点子级末尾（层级约束沿用决策 19：volume 挂 root、chapter 挂 volume 或 root、scene 必须挂 chapter；子级类型由父节点层级推导，无默认值歧义）；输入标题 Enter 确认创建，Esc 取消。
- **查看详情 = 双击节点**：双击节点跳转详情页 `#/outline/:nodeId`（决策 23 承载展示与编辑）。
- **点击标题 = 行内编辑标题**：现有单击编辑保留（点击标题进入行内编辑，Enter 确认、Esc 取消）。
- **调整顺序仍用拖拽**：现有 HTML5 DnD 保留（决策 19 层级约束下拖拽重排/移动），不引入新交互。
- **参考约束**：层级约束与节点 data 字段集沿用决策 19/23，本决策仅改交互形态，不动数据模型与接口。

**为什么**：行级按钮是高频操作的低效入口——「新建子级」需两步（点按钮 + 选层级），键盘 Enter 一步直达且层级由父节点推导零歧义；双击详情是桌面应用通用心智（文件管理器/大纲工具先例）；行内编辑保留单击语义不增加学习成本；行级只留删除使行宽释放给标题与摘要，视觉噪音收敛。

## 决策 38：时间轴交互参考大纲（2026-08 用户裁决，批次十）

用户反馈（2026-08 批次十）：时间轴事件行与组标题行按钮过多（「详情」「编辑」按钮 + 删除），与大纲页交互不一致。经设计讨论与用户裁决，时间轴行级交互对齐决策 37 大纲模式：

- **事件行与组标题行采用大纲交互模式**：双击 = 详情（事件行跳 `#/timeline/:id`，组标题行跳对应 timepoint 详情）；点击标题 = 行内编辑（事件名 / 时间标签文本，Enter 确认、Esc 取消）；移除「详情/编辑」按钮，保留删除按钮（H3 起直接展示）。
- **现有能力保留**：新建（header「+ 新建时间点」/ 组内「+ 新建事件」/ 顶部「+ 新建事件」）、拖拽（时间点整组拖拽 + 事件跨组拖拽改挂载）、折叠、标签筛选等交互全部保留（决策 26/G2 语义不变）。
- **参考约束**：timepoint/event 实体模型、occurs_at 挂载、双独立线性序（决策 26 G2 修订）不变，本决策仅改行级交互形态。

**为什么**：时间轴与大纲同为「树/组 + 行」结构，交互心智应统一——双击详情、点击编辑、行内编辑是决策 37 已验证的模式，复用降低学习成本；移除「详情/编辑」按钮释放行宽（时间轴行本身信息密度高：时间标签 + 名称 + 标签徽标）；删除按钮保留符合 H3「操作按钮直接展示」红线。

## 决策 39：移除实体二级页列表更新时间（2026-08 用户裁决，批次十）

用户反馈（2026-08 批次十）：实体关系设定列表（EntityList 表格）的「更新时间」列信息价值低（列表场景用户关注名称/上级/描述/标签），且排序选项增加认知负担。经设计讨论与用户裁决：

- **列表移除「更新时间」列与排序选项**：实体关系设定列表（EntityList 表格）不再展示「更新时间」列，排序选项移除「更新时间」项（保留名称等既有排序）。
- **详情页元信息保留**：详情页（EntityDetail 等）的创建/更新时间元信息保留——详情场景用户需要感知数据新鲜度，且提案快照比对（决策 14）依赖 updated_at 语义，仅 UI 展示层调整。

**为什么**：列表是扫描/筛选场景，时间列是低频信息且挤占行宽；详情是单对象审视场景，时间元信息有实际价值——按场景取舍，不改变数据模型与接口（updated_at 字段照常返回，仅前端列表不渲染）。

## 决策 40：右键菜单替代行级「带上下文问 AI」（2026-08 用户裁决，批次十）

用户反馈（2026-08 批次十）：决策 35 引入的 6 处行级 AskAiButton（实体/伏笔/参考资料/大纲/时间点/事件）在行内占用空间、视觉噪音大，且「带上下文问 AI」与「建立关联」两个高频行级操作需要更自然的入口。经设计讨论与用户裁决：

- **新增右键菜单（context menu）**：行级交互新增右键菜单，作为行级「带上下文问 AI」AskAiButton 的替代——**删除全部 6 处行级 AskAiButton**（实体/伏笔/参考资料/大纲/时间点/事件行）。
- **右键菜单选项**：
  - **「注入会话上下文」**：复用现有 chat store focusContext 机制（决策 35）——右键行 → 菜单项 → 写入 focusContext → 右栏小条显示，继续当前会话。
  - **「建立关联」**：打开关联建立弹层（新建 relation_records 关联，决策 2 通用关系表；类型/端点按行实体类型预填）。
- **InfoBar「问 AI」统一入口保留**：决策 35 的集中式入口不变——右键菜单是行级快捷入口的替代形态，不改变「全局入口在 InfoBar」的架构。

**为什么**：行级按钮是低频操作的高成本入口（6 处按钮常驻行宽），右键菜单把行级操作收敛到「需要时出现」的上下文交互——桌面应用通用心智（文件管理器/IDE 先例）；「注入会话上下文」与「建立关联」都是「针对当前行对象」的操作，右键语义天然匹配；InfoBar 统一入口保留保证全局 AI 能力不因行级按钮移除而缺失。

## 决策 41：项目规则文件 AGENTS.md（2026-08 用户裁决，批次十，修订决策 25）

用户反馈（2026-08 批次十）：项目提示词（project.json `prompt`）只能经设置页编辑，用户无法在文件管理器中直接维护规则；且规则与代码仓库的 AGENTS.md 心智一致（用户熟悉「项目根放 AGENTS.md」的惯例）。经设计讨论与用户裁决：

- **项目规则文件 = 项目目录下 AGENTS.md**：作为项目规则**唯一事实源**；`project.json` 的 `prompt` 字段**废弃**（不再读写）。
- **自动迁移**：打开项目时若 `prompt` 存在且无 AGENTS.md → 自动迁移写入 AGENTS.md（内容原样，一次迁移后 prompt 不再使用）。
- **设置页改为直接编辑 AGENTS.md 文件**：设置页「项目提示词」多行文本域改为编辑 AGENTS.md 文件内容（读写走文件接口）。
- **外部编辑支持**：用户可在文件管理器中直接编辑 AGENTS.md；web 读取时检测外部修改（mtime 比对，外部修改后提示刷新/重新加载）。
- **注入逻辑保留**：system prompt 的「## 项目设定」段逻辑保留，数据源从 project.json `prompt` 改为 AGENTS.md 文件内容。
- **修订决策 25**：决策 25 中「规则文件机制（rules.md）否决」记录需注明**被本决策取代**——当时否决的是「另立 rules.md 与 prompt 并存」的双通道方案；本决策将规则文件定义为唯一事实源（AGENTS.md 取代 prompt），不存在双通道漂移。

**为什么**：AGENTS.md 是开发者/创作者社区广泛接受的「项目规则」惯例（本仓库自身即用 AGENTS.md 承载项目状态与约束），用户可直接在文件管理器中编辑、可纳入版本管理；prompt 字段藏于 project.json 不可见、不可版本化；自动迁移保证既有用户零手动操作；注入逻辑不变使 AI 上下文语义零变化。

## 决策 42：实体设定页树形视图（2026-08 用户裁决，批次十）

用户反馈（2026-08 批次十）：实体关系设定列表（表格 + 上级设定筛选下拉）与设定树 tab（I4）功能重叠——列表按上级筛选是「定点下钻」，设定树是「全量层级浏览」，两套 UI 维护成本高且心智割裂。经设计讨论与用户裁决，合并为树形视图：

- **设定列表改为树形视图（参考大纲页设计）**：与设定树 tab 合并——层级天然展示（上级设定直观可见），移除表格形态。
- **交互能力**：支持折叠/展开、行内编辑（点击标题）、拖拽调整层级/顺序（HTML5 DnD，belongs_to 层级约束 + 防环校验沿用决策 30）、Enter 新建子级（就地输入行出现在子级末尾）、双击详情。
- **筛选改为搜索 + 标签过滤（树内过滤）**：搜索/标签过滤在树内进行（命中节点及其祖先链保留展示）；**移除表格分页**（树形视图整树展示，层级即导航）。
- **参考约束**：belongs_to 层级模型（决策 30）、递归子树语义（决策 32）不变——树形视图是层级数据的直接投影，上级设定筛选能力被树形导航吸收。

**为什么**：表格 + 筛选下拉是「扁平化」表达层级数据的妥协形态——树形视图让层级结构一目了然，折叠/展开替代「按上级筛选」的定点下钻（树内导航即筛选）；与大纲页交互模式统一（决策 37 的 Enter 新建/双击详情/行内编辑复用）；移除分页符合树形导航的浏览心智（层级即分页）；两套 UI 合并消除维护成本与心智割裂。

## 决策 43：参考资料两类承载——本地 md 文件与外源链接（2026-08 用户裁决，批次十一）

用户反馈（2026-08 批次十一）：参考资料页实际承载两类素材——**本地 markdown 文档**（项目文件夹自包含、可外部编辑）与**外源链接**（URL 收藏）；列表行信息、新建入口、详情页形态、文件同步与存档需按两类分别设计。经设计讨论与用户逐项裁决（Q1=方案 A）：

- **两类承载（kind 维度）**：reference 实体 `data.kind` = `file`（本地 md 文档）/ `link`（外源链接），缺省视为 link（**存量无 kind 条目运行时兼容**：按 link 类展示，`source` 自由文本可点击逻辑保留）——**无 DDL 迁移，SCHEMA_VERSION 保持 5**（kind 是 data JSON 字段，`.passthrough()` 容错；004 迁移先例：JSON 层演进不 bump）。
  - `file` 类：`data.file_name`（references/ 下相对路径）、`data.content`（正文镜像缓存，列表摘要/AI 工具纯 DB 读取不读盘）、`data.file_mtime`（上次同步时的文件 mtime，scan 比对基准）；`data.type` 分类枚举 + `data.tags` 沿用决策 36/31。
  - `link` 类：`data.url` **必填**；`data.content` 可选（备注/摘录）。
- **文件 = 真相源，DB 索引 = 派生镜像（同步方案，2026-08 与用户确认）**：
  - md 文件 = YAML frontmatter（`title` / `category` 分类枚举 / `tags` 数组）+ markdown 正文，**自包含可完整重建索引**；entities 表 reference 行 = 索引（软删/回收站/关系/标签筛选/提案 updated_at 快照等实体机制的载体）。
  - **应用内编辑**（编辑器保存/标题行内编辑/分类标签编辑）：服务端**先原子写文件再更新 DB**（文件写失败 → 操作报错 DB 不动；DB 更新失败 → 文件已写，下次 scan 以文件为准自愈——文件可重建 DB 而 DB 不可重建文件，与决策 16「先 DB 后 JSON」镜像但方向相反）；行内编辑标题只改 frontmatter + 索引，**不重命名文件**（文件名创建时由标题 sanitize 确定，重名自动 `名称 (N).md`，沿用「书名 (N)」先例）。
  - **外部编辑/新增/删除**（文件管理器直接操作）：scan 端点幂等全量比对——**「已索引跳过」= 索引存在 且 文件 mtime === 索引 `file_mtime` 才跳过**（容差 2ms 仅防御 ISO 毫秒截断 roundtrip——与备份体系 1s 容差语义相反，scan 容差过大会漏检真实外部修改）；mtime 不一致 → 以文件为准重新解析 frontmatter + 正文更新索引；文件缺失 → 索引同步软删（进回收站可还原）；软删索引 + 文件回归 references/ → 还原索引。
  - frontmatter 缺失/非法 → 容错按纯 markdown 处理（title=文件名去扩展名、category=material、tags=[]）。
- **软删/回收站文件联动**：file 类软删 → 文件移入 `references/.trash/` + 索引 `deleted_at`；restore 移回 + 还原；purge 物理删文件（trash 端点扩展，决策 12 语义不变）。
- **外源链接仅存索引**（不落文件）：data.db 本就在项目文件夹内（自包含成立），链接无文件本体可重建，data.db 有自动备份兜底。
- **AI 工具联动**：`propose_create_reference` 创建的条目归 link 类（source → url；无 URL 时 url 留空、content 存摘录），工具契约不变（search_references / get_entity 全文照常，content 镜像保证纯 DB 读取）。
- **存档体系联动（决策 27/28/29 扩展）**：备份 zip 白名单扩展打包 `references/` 目录（含 `.trash/`）；export/import/restore 同步（条目路径校验防穿越）；自动备份「有变更才备份」检测在三文件基础上加 references/ 目录内文件最大 mtime。
- **扫描重建**：新增 `POST /api/v1/reference/scan`（幂等，返回 added/updated/restored/removed/skipped/errors 统计）；UI = 列表页「扫描」按钮 + 打开项目检测存在未索引/mtime 不一致文件时提示引导；暂不做自动定时（YAGNI，与自动备份频率体系解耦）。
- **列表页**：行信息 = [标题、分类徽标、标签徽标、来源]（来源：file → 相对路径文本、link → URL 链接可点击跳转）；**交互对齐决策 37/38 大纲模式**——点击标题 = 行内编辑（Enter 确认、Esc 取消）、双击行 = 进详情页、只留删除按钮；右键菜单 [注入会话上下文、建立关联] 复用决策 40（RowContextMenu）；列表不显示更新时间（决策 39 语义，现状已满足）。
- **新建入口分流**：列表标题行「+ 新建参考资料」改为两个按钮——「新建 md 文档」「新建外源链接」；前者直接打开 md 文档详情页（**草稿态**，未落盘，保存时标题必填 → POST 创建落盘），后者打开外源链接详情页。
- **详情页**：
  - md 文档详情页：内嵌 **markdown 编辑器**（编辑形态，分屏预览，无阅读/编辑切换） + 分类/标签编辑 + 「导入 md 文档」按钮 + **建立关联面板**（CreateRelationDialog 复用，源端点预填）+ 删除；保存 → PUT（服务端先写文件再更新 DB）。
  - 外源链接详情页：标题 + URL（必填）+ 分类 + 标签 + 内容（可选备注） + **建立关联面板**（2026-08 用户补充）+ 删除。
- **导入 md 文档（N4）**：浏览器文件选择（.md）→ 前端 FileReader 读文本 → 解析 frontmatter 预填标题/分类/标签 → 正文填入编辑器 → 保存落盘——**纯前端导入，无独立上传端点**（文件内容经既有 entity API 传输，YAGNI）。
- **markdown 编辑器选型（N3，调研结论）**：编辑用 **@uiw/react-md-editor**（React 19 peer 兼容 4.1.1+、textarea + 分屏预览心智与现状一致、内置 light/dark 主题随 `data-color-mode` 与 use-theme 联动、无重型 peer 依赖）；只读预览用 **react-markdown**（VNode 渲染默认安全、轻量）。**风险验证项**（npm 试装 smoke）：bundle 体积、自带 CSS 与 Tailwind 4 preflight 冲突、暗色主题 token 融合、React 19 实测；备选 md-editor-rt（中文文档但 stars 少）；toast-ui/milkdown/vditor 不选（重/定制成本高/WYSIWYG 改写 md 源文本，与「文件即真相」冲突）。
- **跨书籍导入参考资料**：一个参考资料可能对其他书籍有用——**记录为未来迭代**（backlog #16），本轮不实现。
- **B1 修复（列表编辑对话框竞态，2026-08 评审发现）**：列表页 Dialog 编辑随本次交互重构**移除**（完整编辑收敛到详情页）——`openEdit` 先置空表单再异步取详情、接口失败静默停留空表单、回填覆盖用户已输入的竞态根除。

**为什么**：参考资料从「纯文本条目」演进为「文件 + 链接」两类，是真实使用场景的投影（用户把外部素材以 md 文档形态沉淀、以 URL 收藏外源）；文件为真相源 + frontmatter 自包含使索引可完整重建（方案 A 价值）、外部编辑/新增/删除天然可同步（mtime 快照比对）、备份随目录自包含；复用实体体系与决策 37/38/40 交互模式零新增机制成本；无 DDL 迁移使存量数据零风险兼容。


## 决策 44：参考资料分类自定义——取消预置枚举，自由文本 + 项目内聚合建议（2026-08 用户裁决，批次十二）

用户反馈（2026-08 批次十二）：参考资料页分类**不要预置固定类型**，支持用户自定义分类。经设计讨论，用户裁决：**方案 A 变体**——分类从固定枚举（material/inspiration/theory/reference）改为**自由文本**；输入建议**仅聚合项目内已用过的分类**（不含 4 个原默认分类）；用户可自由输入任意新分类。

- **数据契约**：`data.type` 从 `z.enum(REFERENCE_TYPES)` 放宽为 **`z.string().optional()`**（`REFERENCE_TYPES` 常量与 `ReferenceTypeValue` 类型**删除**——shared 不再导出预置分类枚举）；缺省 `material` 兜底保留在写入侧（server reference-files / executor `?? "material"`，存量兼容语义不变）。**无 DDL 迁移，SCHEMA_VERSION 保持 5**（type 是 data JSON 字段，沿用决策 43 kind 先例：JSON 层演进不 bump）。
- **存量兼容**：已有 material/inspiration/theory/reference 条目**原样保留**；前端保留 `TYPE_LABELS` **仅作存量回显映射**（material→素材摘抄 等，注释明确「非可选建议、仅存量显示」），无映射的新分类原样显示字符串。
- **详情页分类输入**：`select` 改为**文本框 + datalist 自动补全**——建议项 = **项目内已用过的分类**（从现有 reference 条目聚合去重，显示回显名、填入原始值），不含任何预置分类；用户可自由输入任意新分类（Enter/失焦即用，保存时写入）。
- **列表筛选**：分类下拉选项 = 「全部分类」+ 项目内已用分类（聚合逻辑同详情页；原生 select 即可，分类数量少，YAGNI 不做可搜索下拉）。
- **AI 工具**：`search_references` / `propose_create_reference` 的 `type` 参数从 `z.enum` 放宽为 `z.string`；工具描述文本去掉枚举列举，改为「分类自由文本（建议沿用项目内已有分类）」；search 结果层 JS 过滤逻辑不变（`summary.type === args.type` 原始值比对）。
- **md 文件 frontmatter**：`category` 字段本就是自由字符串解析（shared `parseReferenceFrontmatter` 无枚举校验），仅放宽服务端类型标注 `ReferenceTypeValue → string`；写入/扫描/回显链路不变。
- **不做**：设置页分类管理（YAGNI，datalist 聚合已满足自定义诉求）；分类重命名/合并（backlog 候选，本轮不做）。

**为什么**：预置枚举是产品对用户素材的臆断分类，实际创作中分类因人而异；自由文本 + 项目内聚合建议零配置满足「自定义」诉求，且天然收敛（建议项随使用增长）；放宽 schema 是纯 JSON 层演进，存量数据零风险；AI 工具 type 参数放宽为 string 后仍可传存量分类过滤，行为不变。

## 决策 45：人物列表行信息修订——状态列移除 + 两行式行布局（2026-08 用户反馈，批次十三）

用户反馈（2026-08 批次十三）：实体关系人物页①「状态是什么？」——character 的 `data.status` 是**无定义的自由文本**（schema.md 仅列字段、无任何语义说明），列表「状态」列无 tooltip/引导，实测存量数据该字段几乎恒为空 → 列恒显示「—」，用户无法理解其含义；②「行显示信息太少」——人物 data 有 `motivation`/`personality[]`/`abilities[]`/`gender`/`age` 等丰富字段，列表只展示名称 + 角色 + 状态 3 列。经设计讨论，用户裁决：

- **状态列从列表移除**（`SUMMARY_COLUMNS.character` 去掉 `key2: status`）——`data.status` 字段**保留**（详情页表单保留、AI 工具 search_entities filters.status 语义不变、服务端 toSummary 提取保留——列表不展示不代表数据契约变更）；**详情页 status 输入框补 placeholder 引导**「如：活跃、退场、已故」（回答「状态是什么」= 人物当前处境状态，自由文本），列表与详情文案口径一致。
- **人物行改两行式行布局**（对齐大纲/参考资料行模式）：第一行 = 名称 + 角色徽标（`summary.role`，`bg-primary/80 + text-primary-foreground` 标签徽标样式，T2 规范）；第二行（弱化样式，`text-xs text-muted-foreground`）= 动机摘要（`summary.motivation` 截断 40 字符）+ 性格/能力标签 chips（`summary.personality`/`summary.abilities` 各前 2 个，服务端摘要截断）。
- **服务端摘要扩展**（toSummary character 分支）：`motivation`（截断 40 字符）、`personality`（前 2 个）、`abilities`（前 2 个）加入 `summary`——截断语义沿用 M2 description 先例（防 search_entities 工具上下文膨胀，决策 15）；`role`/`status` 提取不变。
- **不做**：状态改受控枚举（用户裁决保留自由文本）；性别/年龄入列（信息价值低且存量稀疏，YAGNI）；location/hook 行布局不动（无反馈）。

**为什么**：状态列无定义、无引导、恒空——展示一个用户无法理解且从不填写的列是信息缺陷；两行式布局在列宽受限下最大化信息密度（动机是创作中最常用的上下文，性格/能力标签一眼可读）；服务端摘要截断与既有 M2/决策 15 语义一致，零数据迁移。**为什么**：状态列无定义、无引导、恒空——展示一个用户无法理解且从不填写的列是信息缺陷；两行式布局在列宽受限下最大化信息密度（动机是创作中最常用的上下文，性格/能力标签一眼可读）；服务端摘要截断与既有 M2/决策 15 语义一致，零数据迁移。

> **2026-08 用户复核修订（批次十三卡 13.6）**：首版实现后用户反馈①角色列空白（两行式单 td 渲染与「名称|角色」表头错位）、②性格/能力合并 chips 无法分辨、③详情页残留状态显示。裁决修订：**角色/性格/能力独立成列**（四列表格：名称+动机第二行 | 角色 | 性格 | 能力，各前 2 chips，空值「—」占位）、**状态字段从详情页表单一并移除**（列表与详情均不再展示；存量 data.status 由 .passthrough() 容错保留，AI 工具 filters.status 语义不变）。

## 决策 46：设定树手动排序——同级 sort_order + 复合 move 端点 + 排序模式切换（2026-08 用户反馈，批次十三）

用户反馈（2026-08 批次十三）：实体关系设定页需要排序功能——创建时间排序、名称排序、拖拽排序、上下箭头按钮排序。现状（决策 42）：设定树固定名称排序、拖拽仅调层级（「设定无 sort_order 语义、同父拖拽为 no-op」）——本决策**修订该约束**。经设计讨论，用户裁决：

- **排序粒度 = 同级兄弟**（每个父节点/根级的子列表内排序），层级结构不变；排序方式**切换器**（工具栏「排序: [名称 ▾]」下拉：名称 / 创建时间 / 手动），切换即重排同级。
- **手动排序持久化**：复用 `entities.sort_order` 列（决策 26 引入，setting 行当前恒为 NULL）——**新语义：setting 的 sort_order = 同级线性序（同父组内 0..n-1，NULL = 未参与手动排序）**；**无 DDL 迁移**（列已存在，SCHEMA_VERSION 保持 5——纯语义扩展 + 数据填充）。手动模式排序键 = `sort_order IS NULL, sort_order ASC, name ASC`（存量 NULL 沉底后按名称，渐进生效）；名称/创建时间模式 = 纯前端排序（items 已含 name/createdAt，YAGNI 不加服务端参数）。
- **复合 move 端点** `PUT /api/v1/entity/setting/:id/move`（Req `{ parent_id: string | null, order: number }`，决策 42 拖拽改父流程 + 重排**收敛为一次事务提交**，对齐 G2 event move_to 复合端点先例）：①改父（parent_id ≠ 当前父）→ 事务内建新 belongs_to 边（**防环沿用决策 30**，违反 → 400）+ 删旧边；②重排目标同级组（改父后 = 新父的子级组 / 未改父 = 当前同级组，order 0-based clamp）→ 组内重写 sort_order 0..n-1，仅被移行刷 updated_at（决策 14 版本戳语义）。改父且 order 缺省语义 = 追加到新父子级末尾。
- **拖拽/箭头交互（重排仅限手动模式，用户裁决）**：手动模式下 ①行悬停显示 **↑↓ 箭头按钮**（同级组内上移/下移一位）；②拖拽新增**行间插入线语义**（拖到行上方/下方 1/3 处显示插入线 = 同级重排到该位置），**拖到行上仍 = 调层级**（既有语义不变）；名称/创建时间模式下拖拽仅保留调层级，行间插入线/箭头不出现（排序模式语义清晰不打架）。前端改父流程从「createRelation + deleteRelation 两步」切换为复合 move 端点（详情页 handleSetParent 流程不动，超范围）。
- **前端树排序实现**：`lib/setting-tree.ts` 新增纯函数（同级组排序：name / createdAt / sortOrder+name 三种模式），树构建后对每层 children 按模式排序；`EntitySummary` 增加可选 `sortOrder?: number`（**仅 setting 类型填充**，服务端 toSummary 从行取）。
- **不做**：跨父拖拽时保留插入位（改父即追加末尾，YAGNI）；手动排序的 AI 提案能力（backlog 候选）；character/location/hook 表格的拖拽排序（无反馈，表格已有名称/创建时间排序下拉）。

**为什么**：设定是层级树，全局线性序（event 先例）无法表达「同父内排序」语义——同级组序是树排序的最小完整模型；复用现有 sort_order 列零迁移；复合端点把改父+重排收敛为原子提交，杜绝两步调用的中间态（G2 move_to 已验证该模式）；重排仅限手动模式避免「自动排序被悄悄打破」的认知冲突。

## 决策 47：工具调用展示人类可读化 —— 批量名称解析端点 + 摘要渲染（2026-08 用户反馈，批次十四）

用户反馈（2026-08 批次十四）：会话过程中 tool calling 获取数据/设置数据时，UI 显示的是 sqlite id（如 `char-xxx`、`sc-xxx`），对用户毫无意义。现状：右栏 ChatPanel 的 `ToolCallRow` 展开态直接 `JSON.stringify(args)` 渲染原始参数 JSON（含 `id`/`entity_id`/`node_id`/`parent_id`/`source_id`/`target_id`/`hook_id`/`relation_id`/`outline_node_id` 等字段）；`ProposalCardView` 提案卡 preview 同样 JSON dump（回退形态 `{ type, summary, args }` 的 args 与 `propose_reorder_timepoints` 的结构化 `{ changes: [{ id, order }] }` 均含原始 id）；历史会话消息（chat_messages 回放）走同一渲染路径。经设计讨论与用户裁决：

- **新增批量名称解析端点** `POST /api/v1/names/resolve`（Req `{ ids: string[] }` → Res `{ names: Record<string, { label: string; name: string } | null> }`）：服务端按 **id 前缀分流**解析——`char-`/`set-`/`loc-`/`hook-` → 实体（label = 类型中文，name = 实体名）；`vol-`/`ch-`/`sc-` → 大纲节点（label = 层级中文，name = 标题）；`ref-` → 参考资料（label = 「参考资料」，name = 标题）；`tp-` → 时间点（label = 「时间点」，name = 名称）；`rel-` → 关系（**无名称 → null**，关系 id 不应暴露）；未知/不存在/已软删 → null。**不做**客户端拼 4-5 个现有接口 + 缓存（解析收敛服务端单点，契约测试可控）。
- **client 新增 `summarizeToolCall(tool, args, names)` 纯函数**：按工具名定义参数→友好标签映射（如 `get_entity` → 「查询实体：角色「张三」」、`propose_update_entity` → 「更新实体：角色「张三」」+ 变更字段列表）；id 类字段值经 names 解析为名称，解析失败字段省略不显示。
- **ToolCallRow 展开态改摘要渲染**：展开时收集 args 中 id 类字段 → 调 names/resolve 批量解析 → 渲染摘要行（解析中骨架）；**解析失败 / 未知工具 → 回退原始 JSON**（防御兜底，不丢信息）。
- **ProposalCardView preview 摘要化**：回退形态 `{ type, summary, args }` 只显示 summary + 摘要行（不再 dump args）；结构化 preview（如 `{ changes }`）逐行摘要（「时间点「…」→ 位置 N」）。
- **历史消息回放同路径生效**（渲染层统一，无需区分流式/历史）。
- **不做**：tool_result 内容展示（现状只显示成功/失败图标，保持）；agent/server 层不改动（tool_call 事件仍透传原始 args，解析纯展示层职责）。

**为什么**：工具调用行是「AI 在做什么」的透明性窗口，原始 id 对创作者无信息量——解析为实体/节点名称让「查询/修改了谁」一目了然；解析收敛服务端单点避免客户端多处拼装与缓存一致性；回退 JSON 保证极端情况（新工具/未知 id 前缀）不丢信息。

## 决策 48：用户级配置格式正式化 —— `~/.ai-editor/config.json` schema v1（2026-08 用户裁决，批次十四）

用户需求（2026-08 批次十四）：整理定义出配置格式；配置文件路径 `~/.ai-editor/config.json`。现状：`UserConfigFile` 是 server 包内临时接口（settings.ts 本地定义 `{ model?, thinking_level?, api_key? }`），无正式 schema、无文档（doc/api/endpoints.md 仅一句话带过）；debug.ts 另读项目级 `.ai-editor/config.json`（同名不同目录，不在本决策范围）。经设计讨论与用户裁决（**多供应商 v2 迭代先行放弃**，保持现状只接入 DeepSeek，见 backlog.md）：

- **正式 schema（shared 定义，服务端校验）**：`userConfigFileSchema`（zod，放 `@whispering233/ai-editor-shared/schemas`）：
  ```json
  {
    "schema_version": 1,
    "model": "deepseek-v4-flash",
    "thinking_level": "high",
    "api_key": "sk-xxx"
  }
  ```
  - `schema_version`：可选字面量 `1`（缺省 = v0 旧格式，同结构直接兼容，无需迁移）；**为未来多供应商迭代预留演进位**（v2 将引入 `providers` 数组与 `model` 复合引用 `provider/model`，本决策不做）
  - `model`/`thinking_level`/`api_key` 语义与现状完全一致（决策 17/34）
- **读侧兼容不写回**：读取时 `safeParse` 失败 → 空配置（现状 catch 语义）；v0 旧格式（无 `schema_version`）直接按同结构读取；**不主动改写用户文件**（config.json 是用户自有文件，避免意外写入——与决策 41 的 AGENTS.md 自动迁移不同，那个是应用自有数据；用户下次在设置页保存时自然落新格式）。
- **server settings.ts 改造**：删除本地 `UserConfigFile` 接口，改用 shared schema 推导类型 + `safeParse` 校验读入；写入路径复用 `writeJsonAtomic`（决策 11 同款，不变）。
- **文档落点**：配置格式完整说明写入 doc/api/endpoints.md「系统设置」区（含示例与优先级：环境变量 `DEEPSEEK_API_KEY` > config.json）；decisions.md 本决策为格式总纲。
- **不做**：多供应商（providers 数组、baseUrl、自定义模型列表）——2026-08 用户裁决放弃，记录 backlog.md 待后续迭代；配置 schema 的跨版本迁移框架（v1 单格式无迁移需求，YAGNI）。

**为什么**：配置格式是用户与产品的持久契约，临时接口导致文档与实现漂移；schema 正式化让「整理定义出配置格式」有单一事实源（shared zod + endpoints.md），读侧兼容保证存量 config.json 零破坏；schema_version 预留位使未来多供应商迭代不破坏 v1 文件。

## 决策 27 修订：备份频率新增 1 分钟选项（2026-08 用户反馈，批次十四）

用户需求（2026-08 批次十四）：备份功能支持 1 分钟备份 1 次选项（高频备份场景：写作密集期希望每次修改都有存档）。决策 27 原选项枚举为关闭 / 5 / 10 / 15 / 30 / 60 分钟。**修订**：`BACKUP_FREQUENCIES = [1, 5, 10, 15, 30, 60]`（shared 常量，前后端同源）；纯增量加选项，不动其他逻辑——服务端校验 `includes()` 自动生效、client 下拉自动生成「每 1 分钟」；「有变更才备份」语义天然避免 1 分钟频率产生垃圾备份（无变更 tick 跳过）；每项目保留 20 份策略不变。**为什么**：1 分钟档满足「每次修改都有存档」的高频场景，纯常量增量零风险；变更检测兜底保证不刷盘。
