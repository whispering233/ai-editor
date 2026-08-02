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
| 前端 | React 19 + Vite 7 + Zustand 5 + Tailwind 4 + shadcn/ui（Base UI，oklch 主题 tokens） |
| 路由 | 自制 hash 路由（`useHashRoute`，无 React Router） |
| Schema 校验 | Zod 4（仅服务端执行，client 不打包校验函数） |
| AI 调用 | 原生 fetch → DeepSeek API（模型可配置，默认 `deepseek-v4-flash`） |
| 测试 | vitest（各包独立 `test` script） |

## UI 布局（三栏工作台，2026-08 重构）

文学氛围双主题（浅色暖羊皮纸+牛血红 / 深色蓝黑曜石+琥珀烛光），三栏固定 1:5:4：

- **左栏**：产品标识 + 书架（项目→会话二级树，点击打开/切换）+ 底部设置与主题切换
- **中栏**：项目信息条 + 6 tab（概览 | 大纲 | 画布 | 实体关系 | 伏笔 | 回收站）+ 页面内容
- **右栏**：AI 聊天常驻（会话归属项目，`<1024px` 折叠为抽屉）

样式规范见 `doc/ui/layout.md`（当前实现样式，文档即契约）。

## 包结构

```
shared → llm / db / tools → agent → server    （依赖方向，client 只依赖 shared）
```

- `@ai-editor/shared`：前后端共享类型 / 常量 / 工具 / API 契约（零 Node 依赖，浏览器安全）
- `@ai-editor/db`：SQLite 建表 / 查询 / outline.json 原子写 / schema 演进删库重建
- `@ai-editor/server`：Hono API + SPA 静态托管（单进程部署）
- `@ai-editor/client`：React SPA

## 快速开始

```bash
pnpm install
pnpm -r build        # 按依赖序构建 7 包

# 开发态（client :5173 + server :3456，proxy /api）
pnpm dev

# 测试项目（借鉴 inkos test-project 模式，运行时数据不入库）
pnpm start:test-project
# → 生产态启动（需先 pnpm -r build）：浏览器自动打开 http://127.0.0.1:3456
# → 无项目时左栏书架 + 中栏引导创建/打开项目（落盘 test-project/books/<书名>/）

# 验证
pnpm typecheck && pnpm lint && pnpm -r test
```

## 打包安装（借鉴 inkos 发布机制）

```bash
# 6 包 pack（prepack 钩子自动：SPA 进包 + workspace:* 替换真实版本）
for p in shared llm db tools agent server; do
  pnpm --filter @ai-editor/$p pack --pack-destination /tmp/ai-editor-packs
done
# 测试目录安装（未发布 registry 也能装——npm 对同批 tarball 复用依赖）
npm install /tmp/ai-editor-packs/*.tgz
# 运行：服务 + 自动打开浏览器界面
npx ai-editor <项目目录>
```

## 文档（文档即契约）

| 目录 | 内容 |
|------|------|
| `doc/design/` | 产品定位、架构与分包、关键决策 1-21、backlog、任务清单与进度 |
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
