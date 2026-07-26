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
└── (大纲节点, sc-37) ──[属性变化]──→ (人物, char-3)
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

到达任意节点的状态 = 初始值 + 从根节点到该节点路径上所有 Delta 的累积。Delta 挂载在通用关系表中（`relation_type = 'attribute_change'`），不侵入大纲的 JSON 结构。

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
  ⑥ 自动打开浏览器 → http://localhost:3456

之后所有操作都在浏览器 GUI 中完成：
  ├── 管理人物/设定/地点
  ├── 编辑大纲树
  ├── 在画布上探索剧情路径
  └── AI 对话
```

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
await startServer(projectRoot, port);     // 启动单进程服务
```

没有任何子命令解析逻辑，用户不需要学习任何 CLI 操作。

### 项目自动初始化

首次在空目录运行时，自动创建项目骨架：

```typescript
export async function ensureProjectInitialized(dir: string): Promise<boolean> {
  const configPath = join(dir, 'project.json');
  if (existsSync(configPath)) return false;   // 已有项目，跳过

  // 首次自动初始化
  writeFile(configPath, JSON.stringify(buildDefaultConfig(dir)));
  exec('npx better-sqlite3 init data.db');     // 建表
  writeFile('outline.json', '{"id":"root","children":[],"orphan_nodes":[]}');
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
