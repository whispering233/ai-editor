# AI Editor

面向小说创作者的本地优先 AI 辅助工具。**AI 是创作顾问，不是代笔**——帮助管理创作要素、探索剧情可能性、发现设定矛盾，正文永远由作者书写。

## 技术栈（架构参考 @actalk/inkos）

本项目在工程组织上借鉴了 [inkos](https://github.com/Narcooo/inkos)（长篇小说创作 AI Agent）的成功实践：pnpm monorepo 分包、共享契约层、打包发布机制与测试项目模式。

| 层 | 技术选型 |
|---|---------|
| 包管理 | pnpm workspace（7 包 monorepo） |
| 运行时 | Node ≥ 22.12，全仓 ESM |
| 语言 | TypeScript strict mode |
| API 服务端 | Hono 4 + `@hono/node-server` |
| 数据库 | better-sqlite3 ^13（WAL，N-API 预编译） |
| 前端 | React 19 + Vite 7 + Zustand 5 + Tailwind 4 + shadcn/ui（Base UI，oklch 主题 tokens）+ Prettier + prettier-plugin-tailwindcss（样式工程化，L 批次） |
| 路由 | 自制 hash 路由（`useHashRoute`，无 React Router） |
| Schema 校验 | Zod 4（仅服务端执行，client 不打包校验函数） |
| AI 调用 | 原生 fetch → DeepSeek API（模型可配置，默认 `deepseek-v4-flash`） |
| 测试 | vitest（各包独立 `test` script） |

## UI 布局（三栏工作台，2026-08 重构）

文学氛围双主题（浅色暖羊皮纸+牛血红 / 深色蓝黑曜石+琥珀烛光），三栏可拖拽调宽 + 收起/展开（F7）：

- **左栏**：产品标识 + 书架（项目→会话二级树，点击打开/切换）+ 底部设置与主题切换
- **中栏**：项目信息条 + 7 tab（概览 | 大纲 | 画布 | 实体关系 | 伏笔 | 时间轴 | 回收站）+ 页面内容
- **右栏**：AI 聊天常驻（会话归属项目，`<1024px` 折叠为抽屉）

样式规范见 `doc/ui/layout.md`（当前实现样式，文档即契约）。

## 包结构

```
shared → llm / db / tools → agent → server    （依赖方向，client 只依赖 shared）
```

- `@whispering233/ai-editor-shared`：前后端共享类型 / 常量 / 工具 / API 契约（零 Node 依赖，浏览器安全）
- `@whispering233/ai-editor-db`：SQLite 建表 / 查询 / outline.json 原子写 / schema 演进（增量迁移 E5 + 未来版本拒绝打开 E4，无迁移路径时删库重建兜底）
- `@whispering233/ai-editor-server`：Hono API + SPA 静态托管（单进程部署）
- `@whispering233/ai-editor-client`：React SPA

## 快速开始

```bash
pnpm install
pnpm -r build        # 按依赖序构建 7 包

# 开发态（client :5173 + server :3456，proxy /api）
pnpm dev

# 测试项目（借鉴 inkos test-project 模式，运行时数据不入库）
pnpm start:test-project
# → 先 pnpm -r build（代码变动自动构建最新），再生产态启动
# → 浏览器自动打开 http://127.0.0.1:3456
# → 无项目时左栏书架 + 中栏引导创建/打开项目（落盘 test-project/books/<书名>/）

# 验证
pnpm typecheck && pnpm lint && pnpm -r test

# 调试（服务端日志，纯配置文件方式；无配置文件 = 默认关闭防刷屏）
# 配置文件：创作根/.ai-editor/config.json（start:test-project 时创作根 = test-project/，已含默认示例）
#   默认示例（五类别全开）：{ "debug": { "enabled": true, "categories": ["chat", "request", "stream", "usage", "http"] } }
#   自定义示例（只显示请求和 tokens 统计）：{ "debug": { "enabled": true, "categories": ["request", "usage"] } }
#   五类别：chat（agent 事件）/ request（LLM 完整 prompt）/ stream（原始 SSE chunk）/
#          usage（tokens 统计）/ http（hono 请求日志）；categories 缺失 = 全部类别；
#          enabled=false 或缺失 = 全关；文件不存在/非法 JSON/结构不符 = 全关
#   （环境变量开关已移除，配置文件是唯一来源）
```

## 当前能力（2026-08）

- **项目管理**：书架模式（`books/` 子目录）、创建/打开/关闭/配置、LLM 设置（模型/key）
- **大纲**：严格三层（卷→章→场景）增删改移、节点详情（麦基《故事》结构化字段）
- **实体与关系**：六类实体（人物/设定/地点/伏笔/事件·时间轴/时间标签点·时间轴）CRUD、k 跳关系遍历、Delta 变更追踪与状态计算（computeState）；**设定层级（决策 30）**——父子关系用 `belongs_to` 表达（防环校验），详情页「层级」区块 + 实体关系页「设定树」tab（递归树视图）；**标签分类（决策 31）**——设定分类统一 `data.tags`，列表标签列 + 标签筛选（`?tag=`）+ 新建行标签输入（datalist 自动完成 + 快捷选择）；**列表与编辑增强（批次六 M1-M3，2026-08）**——设定列表行显示上级设定（chip 点击直达父详情）与描述（截断展示 + hover 查看）；标签/规则编辑器回车添加下一项 + 拖拽排序（HTML5 原生 DnD）；**上级设定筛选（决策 32，批次七）**——设定列表新增「上级设定」下拉，选定后只显示其直接及**所有后代设定（递归子树）**，与标签筛选/搜索/排序组合（AND）
- **时间轴（阶段 C + G2 修订 + H1-H6 交互优化）**：**时间标签点（timepoint）与事件双实体**——事件经 `occurs_at` 挂载到时间点（1:n），时间点与事件各有独立线性序（拖拽时间点 = 整组移动不动内部、拖拽单条事件 = 组内重排/跨组自动改挂载）；垂直时间轴 + 时间点组块 + 未挂载兜底区；时间点可重命名、组内新建事件、AI 按时间标签语义排序（提案确认）；`occurs_in` 锚定大纲场景（倒叙/多时间线可表达）；软删回收站；交互优化：删除入口直接展示、软删/还原免二次确认、操作按钮不收入 `...` 菜单、文字按钮带边框、标题行信息与操作右移、事件行“N 节点”计数靠右
- **伏笔系统（S9 已就绪）**：伏笔池面板（活跃/已回收/已废弃分组、新建埋点、推进/回收/废弃复合写确认、依赖链展开、软删级联）+ 大纲节点伏笔标记（📌 埋设/⏩ 推进/✅ 回收徽标）；健康指标展示留后续迭代（backlog #13）
- **回收站**：软删还原 / 彻底清除 + 启动一致性校验兜底
- **AI 对话链路（S6-S8 已就绪）**：DeepSeek SSE 流式客户端、46 个工具（查询 8 / 分析 5 / 伏笔 5 / 提案 15 / 执行 13）、agent 主循环（8 轮 / 120s / token 三重保险）、提案确认流程（卡片确认/拒绝 + 失效处理，全链路可用）、chat SSE 路由（心跳 15-30s / 断连检测 / 全链路取消）——配置 key 后右栏 ChatPanel 可直接对话
- **交互体验（2026-08）**：AI 确认提案后中栏数据自动刷新 + InfoBar 全局刷新按钮；刷新页面自动恢复最近会话；渲染异常防白屏（可恢复错误卡）
- **样式工程化（L 批次，2026-08）**：client 包 Prettier + prettier-plugin-tailwindcss 强制格式（长 className 自动折行 + 类排序）；共享样式常量 `lib/styles.ts`（图标按钮/输入框/错误横幅/骨架/区块卡）+ `EmptyState`/`SectionCard` 组件；全仓硬编码色类（zinc/white/red）清零 token 化（深色主题亮色异常同步修复）；规范见 `doc/ui/layout.md` §4.4
- **数据备份（E1-E3 + 阶段 B2 已就绪）**：一键导出完整项目（zip 打包 project.json + outline.json + data.db，含 WAL 完整快照）/ 从备份导入（服务端校验 + 原子搬入）；**自动备份**——按频率（关闭/5/10/15/30/60 分钟，默认 10 分钟开启，跟随书籍）有变更才备份，每项目保留最近 20 份；**手动备份**——设置页「立即备份」可带自定义名称，列表以简单标签区分手动/自动（B2.5/B2.6，决策 28/29）；**备份重命名**——列表行内编辑改名称（时间与类型标签保持）；**加载备份**——设置页历史备份列表（强确认 + 覆盖前自动快照后悔药）或书架导入文件（以 project_id 为 key：匹配 → 覆盖恢复 / 不匹配 → 新书，同名不再 409 可重命名或去重并存）；书架支持重命名书名——「数据主权归用户」（product.md 原则 1）
- **调试**：创作根 `.ai-editor/config.json` 细粒度五类别（chat/request/stream/usage/http，见上文示例；无配置文件默认关闭）

## 打包安装（借鉴 inkos 发布机制）

```bash
# 6 包 pack（prepack 钩子自动：SPA 进包 + workspace:* 替换真实版本）
for p in shared llm db tools agent server; do
  pnpm --filter @whispering233/ai-editor-$p pack --pack-destination /tmp/ai-editor-packs
done
# 测试目录安装（未发布 registry 也能装——npm 对同批 tarball 复用依赖）
npm install /tmp/ai-editor-packs/*.tgz
# 运行：服务 + 自动打开浏览器界面
npx ai-editor <项目目录>
```

## 发布与安装

**用户安装**（发布形态：6 包全部发布 npm，用户只装 server 一个包，其余 5 个依赖自动拉取）：

```bash
npm install -g @whispering233/ai-editor-server
ai-editor <项目目录>   # 启动服务 + 自动打开浏览器 http://127.0.0.1:3456
```

> 版本说明：**当前最新版 v0.0.13**（由 CI OIDC 自动发布，发布全链路自动化已验证）；v0.0.1/v0.0.2 因发布管道缺陷（manifest 残留 `workspace:*` 协议）不可安装，已计划 deprecate 标注；安装时使用 `@whispering233/ai-editor-server@latest` 即可。

**发布前置（一次性，npmjs 手动）**：① 开启 npm 账号 **2FA**（npmjs 要求开启两步验证才能配置包管理；开启会撤销现有 token，需重新生成 Automation token）；② 为 `@whispering233/ai-editor-shared`、`@whispering233/ai-editor-llm`、`@whispering233/ai-editor-db`、`@whispering233/ai-editor-tools`、`@whispering233/ai-editor-agent`、`@whispering233/ai-editor-server` 六包各配置 Trusted Publisher：Publisher = GitHub Actions、工作流名 = `publish.yml`；配置后 CI 无需 token（OIDC 自动换证）。

**发布流程**（详见 AGENTS.md「版本发布流程（E6）」）：更新根 `CHANGELOG.md`（Unreleased 搬运为新版本段）→ `pnpm release:version X.Y.Z` 同步 6 包 + client + 根版本 → commit + 手动 annotated tag `vX.Y.Z` → push tag 后 workflow 自动执行（release.yml 建 GitHub Release，publish.yml 发布 6 包 npm + 安装态冒烟验证）。

## 文档（文档即契约）

| 目录 | 内容 |
|------|------|
| `doc/design/` | 产品定位、架构与分包、关键决策 1-32、backlog、任务清单与进度 |
| `doc/api/` | 端点契约、AI 工具目录、数据流 |
| `doc/database/` | 表结构 / outline.json / project.json 契约、伏笔系统 |
| `doc/ui/` | 当前 UI 布局样式设计（三栏工作台 `layout.md` + 各页面细案） |
| `test-project/` | 测试项目目录（运行时数据不入库） |

阅读顺序见 `doc/README.md`。实现任何功能前先读对应文档——AGENTS.md 是开发者的第一站。

## 设计原则

- **本地优先**：全部数据存本地（project.json + outline.json + data.db），不上传云端
- **结构体先行**：创作要素结构化（人物/设定/地点/伏笔），AI 在结构上做语义分析与建议
- **AI 只提案不写入**：工具分「自动 / 提案确认」两级，写操作必须用户确认
- **软删 + 回收站**：误删可还原，purge 才物理清除

## License

[MIT](LICENSE) © 2026 whispering233
