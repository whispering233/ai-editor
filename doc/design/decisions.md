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
