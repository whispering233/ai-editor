# 关键架构决策

## 决策 1：节点即大纲（统一模型）

大纲的树状结构和剧情探索的图状结构共享同一数据中心。

```
大纲视图（树）         画布视图（图）
 卷1                       🎯 结局(游离)
 ├ 第1章              ┌────┘
 │ ├ 场景A ←──────────┤ 同一数据
 │ └ 场景B            └────┐
 └ 第2章                   路径A ─→ 路径B
```

- 在大纲里拖拽重排 → 画布上的连线自动更新
- 在画布上把游离节点拖入卷 → 大纲里自动归位
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
  ① cd ~/projects/my-novel
  ② ai-editor                            ← 唯一命令

CLI 入口:
  ③ 拿到 process.cwd() → ~/projects/my-novel
  ④ 检测 project.json 是否存在
     不存在 → 自动创建 project.json + data.db + outline.json
     存在   → 直接加载
  ⑤ 启动 Hono 服务端，传入项目路径
  ⑥ 自动打开浏览器 → http://127.0.0.1:3456

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
    '{"id":"root","type":"root","children":[],"orphan_nodes":[]}');
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
- 画布上的推演连线（`plot_edge`）不参与状态计算。
- 推演（what-if 分析）是「只读路径计算 + 提案生成器」：AI 推演产生的状态变化**不落库、不进入主状态**，只以提案形式呈现，用户确认后由 executor 写入 `delta_records` 成为事实。推演永不直接写数据。
- 游离节点（`orphan_nodes`）不在树父链上，其状态 = 初始状态 + 直接挂在该节点上的 Delta；归位进大纲树后自动获得完整路径累积语义。

**为什么**：路径唯一才能保证状态计算结果确定可复现；推演与事实分离，避免 AI 的假设污染创作数据。

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
- **级联软删**：软删实体/节点时，其关联的关系与 Delta **一并软删**——`relation_records` / `delta_records` 增加 `deleted_at` 标记；常规查询默认过滤软删对象，回收站 API 是访问软删对象的唯一入口。
- **级联还原**：restore 时还原本体 + 关联的关系与 Delta；**purge** 时才物理清除（实体连同其关系与 Delta，节点连同递归子树）。
- UI 提供回收站与还原入口；回收站定期清理（按 `deleted_at` 判定保留时长）。

**为什么**：创作场景误删成本高，软删为还原留余地；关系与 Delta 随本体一并软删，避免悬挂引用，还原时数据完整恢复；purge 兜底释放空间。

## 决策 13：schema 演进 —— MVP 删库重建

- MVP 不做数据迁移：`data.db` 通过 `PRAGMA user_version` 记录 schema 版本，启动时检测不匹配则**删除重建**并提示用户；`project.json` 增加 `schema_version` 字段。
- **版本判定规则**：以 data.db 的 `user_version` 为准判定是否重建；`project.json` 的 `schema_version` 仅用于 JSON 结构判断；首次初始化时两个版本号都写入（见决策 8 初始化流程）。
- **重建时同步重置 outline.json**（先备份为 `outline.json.bak`）并清空回收站，避免「大纲完整、实体全空」的半状态。
- 不写迁移脚本（YAGNI）。
- **约束**：此策略仅在正式发布前可接受；首次发布前必须重新评估（发布后用户持有真实创作数据，删库不可接受）。

**为什么**：MVP 阶段 schema 必然频繁变动，迁移脚本成本高收益低；删库重建换取开发速度，代价由「未发布无真实数据」这一前提兜底。存储双轨下只重建 data.db 会留下大纲与实体割裂的半状态，必须同步重置 outline.json 并留备份。

## 决策 14：提案生命周期 —— 仅内存

- 提案（proposal）仅存服务端内存，随 SSE 事件推送，不落盘。
- 确认（confirm）时服务端**重新校验**：提案引用的实体/大纲节点仍存在，且其 `updated_at`（或版本号）与提案生成时的快照一致；存在性失败或无快照比对失败返回 409，前端提示重新生成提案。
- 无过期清理机制、无跨会话恢复（提案是瞬态交互对象）。

**为什么**：提案是毫秒级的交互对象，落盘与恢复机制收益为零；「存在性 + updated_at 快照比对」的双重校验防止「提案生成后数据已被其他操作改变」导致的脏写入。

## 决策 15：agent 循环终止与失败处理

- 主循环设三重保险：max iterations（8 轮）、单轮超时（120s）、token 预算上限。
- 工具执行失败时以**结构化文本喂回 LLM 自纠**；超限则发 `error` 事件终止循环。
- 模型调用失败（429/5xx/超时）按重试策略（`llm/retry.ts`）退避重试，最终失败以 error 事件呈现。

**为什么**：LLM 可能陷入死循环或失控调用，必须用硬性预算兜底；失败语义对用户可见（error 事件），不静默吞掉。

## 决策 16：SSE 中断全链路取消

- 浏览器刷新/断网导致 SSE 断开时，服务端通过 AbortController 全链路取消：agent 循环终止、DeepSeek fetch 中止。
- 未确认提案作废；正在执行的写操作完成当前一步后停止。
- 写操作顺序固定为**先 DB 后 JSON**（data.db 先行、outline.json 随后）；两存储间无原子性，断电/取消可能造成「DB 已写、JSON 未写」的不一致，由 `find_orphan_elements` 工具兜底修复。
- 客户端重连后提示「上次会话已取消」。

**为什么**：SSE 断开后继续跑 agent 是纯浪费（结果无处可送），且未确认提案残留会造成状态不一致；全链路取消保证资源及时释放。跨 data.db 与 outline.json 两存储无法做到事务性回滚，故不承诺回滚，改为固定写序 + 检测工具兜底。

## 决策 17：安全基线

- 服务默认绑定 `127.0.0.1`，不对外网开放；端口占用时自动 +1 递增并打开实际端口（与决策 8 统一）。
- 中间件对**全部请求**（含读）统一校验 `Origin`/`Host` 头，拒绝非本机来源（DNS rebinding 下读操作同样是敏感操作，防 CSRF / DNS rebinding）。
- DeepSeek API key：环境变量 `DEEPSEEK_API_KEY` 为主；设置页可配置并写入用户级配置文件（如 `~/.ai-editor/config.json`）。**key 不进入项目文件**（project.json / outline.json / data.db），保持「代码与数据物理隔离」。
- 项目路径校验：create/open 时路径需规范化（resolve）、防护符号链接逃逸；open 必须校验 `project.json` 存在。

**为什么**：本地工具的服务进程若被外网/恶意页面利用即可读写用户全部创作数据，本机绑定 + 全请求来源校验 + key 隔离把攻击面压到最小。

## 决策 18：对话历史持久化

- 新建 `chat_messages` 表入 data.db：session_id、role（user/assistant/tool）、content、tool_calls（JSON）、created_at（见 `doc/database/schema.md`）。
- MVP 只存原始消息，不做摘要持久化；会话级滑动窗口裁剪与摘要压缩仍在 agent/session.ts 运行时完成（决策 6 分层上下文策略）。
- 服务重启后通过 session_id 重建「继续上次对话」。
- 兑现 product.md「对话历史在本地保存」的承诺。

**为什么**：对话历史是本地创作数据的一部分，落库后重启不丢、可续聊；摘要持久化属优化项，MVP 不做（YAGNI），裁剪压缩留在运行时即可。
