# AI Editor

面向小说创作者的本地优先 AI 辅助工具。**AI 是创作顾问，不是代笔**——帮助管理创作要素、探索剧情可能性、发现设定矛盾。正文（章级）在应用内用块编辑器书写、随书备份与导入导出，但 **AI 对正文只有只读权限**：能读、能评论、能建议，工具面上不存在改写入口——落笔永远由作者完成。工程组织借鉴 [inkos](https://github.com/Narcooo/inkos)：pnpm monorepo 分包、共享契约层、打包发布机制与测试项目模式。

## 技术栈

| 层 | 技术选型 |
|---|---------|
| 工程 | pnpm workspace（7 包：5 发布包 + 私有 client / desktop）；Node ≥ 22.12；全仓 ESM；TypeScript strict；测试 vitest（各包独立 `test` script） |
| 服务端 | Hono 4 + `@hono/node-server`；Zod 4（仅服务端校验）；better-sqlite3 ^13（WAL，N-API 预编译）+ drizzle-orm 0.45 |
| 前端 | React 19 + Vite 7 + Zustand 5 + **antd v6**（主题 = Notion 工作区暖灰 token 覆盖）+ `@ant-design/icons` + `@ant-design/x`（Bubble/Sender）+ `@ant-design/x-markdown`（流式）+ Tailwind 4（仅布局）+ **@blocknote/core·react·ariakit**（块编辑器，exact pin）；自制 hash 路由 |
| AI 运行时 | 嵌入 `@earendil-works/pi-coding-agent` 0.85.1（**exact pin**）：模型目录、凭据、会话文件、重试、上下文压缩、工具派发全由 pi 承担，**凡调 LLM 一律走 pi 的 Agent 路径**；本仓只提供领域工具、内核提示词与 HTTP/SSE 契约 |
| 桌面版 | Electron 44.3.0（**exact pin**）+ electron-builder；主进程内嵌 server，与 CLI 版共用同一份数据 |

## 界面与布局

视觉语言 = **Notion 工作区**一脉：暖灰纸感中性色（`#37352f` 暖炭墨 / `#f6f5f4` 外壳底 / 三层描边）、hairline 分栏、零阴影、扁平，**彩色只服务状态与标签**；组件语言只有一套 antd，排版四档 20/16/14/12。**视觉契约（单一事实源）= `docs/ui/DESIGN.md`**，纪律由 `design-discipline.test.ts` 断言。

书架主页 + 一级导航 + 常驻聊天三区，可拖拽调宽 + 收起/展开（宽度与收起态、写作偏好、大纲视图选择记 localStorage）：

- **`#/` 书架主页**：书籍列表（打开高亮、行内导出/重命名/继续创作/**删除书籍**——已启用云备份时先推一份再删，可选同时删云端备份）+ 新建 / 导入备份 / **从云端恢复** / 打开其他路径
- **`#/manuscript/:chapterId` 正文书写面**（入口：大纲页章视图行 / 章详情「写正文」）：常显写作工具条（块类型 / 格式 / 颜色 / 对齐 / 缩进 / 链接 / 撤销重做 / 保存 / 写作设置 / 专注模式）+ 铺满剩余高度的写作面；写作偏好（字体·字号·行高·纸色·纸纹理·段首缩进）记本机、所有正文共用；停止输入约 1.5s 自动保存，另有手动保存与保存时间
- **左栏**：`◈ 书架` 入口 + 书名按钮（项目概览）+ 八项导航（大纲 | 人物 | 设定 | 地点 | 伏笔 | 时间轴 | 关联 | 参考资料）+ 回收站 + 设置 / 主题切换
- **中栏**：信息条（项目名、阅读进度、语言、全局刷新）+ 页面内容区 + 右下悬浮「问 AI」（带当前页面上下文注入右栏）
- **右栏**：AI 聊天常驻（会话随项目目录走、窄屏折叠为抽屉；x `Conversations` 会话列表 + x Bubble / x-markdown 消息流 + 工具调用行 + 提案确认卡；输入框下方 = 配置行（模型选择 / 思考强度）+ **会话状态栏**（上下文占用 · 费用 · 解码速度 · 缓存命中率 · 累计 tokens；只读、窄栏按优先级隐藏，见 `docs/ui/DESIGN.md`））
- **三栏默认宽度**：左 10% / 右 40% / 中栏吸收剩余（1:5:4 在 1600–2400 视口精确成立）

## 包结构

```
shared → db → tools → agent → server    （依赖方向；client 只依赖 shared，desktop 只依赖 server）
```

`shared`（类型 / 常量 / API 契约，浏览器安全）· `db`（SQLite 建表 / 查询 / 原子写 / 增量迁移）· `tools`（领域工具，TypeBox schema）· `agent`（pi 运行时装配、内核提示词、会话事件投影）· `server`（Hono API + SPA 静态托管）· `client`（React SPA）· `ai-editor-desktop`（Electron 外壳，不含业务逻辑）。

## 桌面版（安装包）

装完双击即用（**不需要 Node / npm**）；**当前只提供 Windows 安装包**（macOS / Linux 等有真实用户需求再做）：

| 平台 | 安装包 | 首次打开注意 |
|---|---|---|
| Windows | `AI-Editor-<版本>-win-x64.exe`（NSIS） | 未签名 → 可能弹 SmartScreen，选「仍要运行」 |

- 安装包挂在对应版本的 GitHub Release；首次启动**零交互**用 `<文档>/AI Editor` 作书库，可在 设置 → 通用 → 书库位置 更改（路径不可用时逐级回退 `<主目录>/AI Editor` → `<userData>/AI Editor`）；与 CLI 版**共用同一份数据与凭据**（`~/.pi/agent/`、项目目录格式一致），两边可打开同一个书库
- **自动更新（仅 Windows 安装态）**：启动后自动检查 GitHub Releases，下载完由你决定何时重启安装（菜单 → 帮助 → 检查更新…）；只替换程序文件、不动书库。⚠ **首个带更新能力的版本需手动下载安装一次**
- 本地出包 `pnpm desktop:dist`（产物在 `packages/desktop/release/`；**Windows 包由 CI 出**）；与 npm 包共用同一个 tag

## 快速开始

**用户安装（CLI）**：`npm install -g @whispering233/ai-editor-server` → `ai-editor <项目目录>`（启动服务并打开浏览器 `http://127.0.0.1:3456`）；发布链路与 npmjs 一次性前置见 `docs/design/build.md`。

```bash
pnpm install
pnpm -r build              # 按依赖序构建 7 包
pnpm dev                   # 开发态：client :5173 + server :3456（proxy /api）
pnpm start:test-project    # 测试项目（数据落 test-project/books/，该目录整体不入库）
pnpm typecheck && pnpm lint && pnpm -r test   # 验证
```

运行、构建、打包与发布链路见 `docs/design/build.md`；服务端调试日志（创作根 `.ai-editor/config.json` 四类别 chat / request / usage / http，无配置文件即全关）见 `docs/design/config.md`。

## 当前能力（逐版本变更历史见根 `CHANGELOG.md`）

- **项目管理**：书架模式、创建 / 打开 / 关闭、项目规则文件 `AGENTS.md`（取代 project.json `prompt`，支持外部编辑检测）
- **大纲**：卷→章→场景三层（章只能挂卷）增删改移 + 拖拽 / 行内编辑 / 右键菜单；卷章自动编号（`第N卷` / `第N章`，纯展示）与双视图（大纲树 / 章视图）；节点详情含麦基《故事》结构化字段
- **正文**：章级块文档编辑器（标题 / 列表 / 引用 / 代码 / 表格 / 图片），自动保存 + 冲突提示，导入导出（块 JSON 无损、Markdown 有损）
- **实体与关系**：七类实体（人物 / 设定 / 地点 / 伏笔 / 事件·时间轴 / 时间标签点·时间轴 / 参考资料）CRUD、k 跳关系遍历、设定层级（`belongs_to` 防环）与树形视图、标签分类与筛选、Delta 变更追踪与 `computeState`（章序前缀累积）
- **人物页**：master-detail 工作台——人物档案（可编辑）/ 阅读进度（只读）/ 人物关系网 / 其他关联四个平级 tab；能力面板 = 用户自定义字段树
- **时间轴**：时间标签点与事件双实体（`occurs_at` 挂载、独立线性序、拖拽重排与跨组改挂）、`occurs_in` 锚定大纲场景（倒叙 / 多时间线可表达）
- **伏笔**：伏笔池面板（活跃 / 已回收 / 已废弃、推进 / 回收 / 废弃复合写确认、依赖链展开）+ 大纲节点伏笔标记
- **参考资料**：第 7 类实体（`ref-` 前缀），表格列表 + 块编辑器正文 + 分类 / 标签 / URL；Markdown 与块 JSON 导入导出
- **数据备份**：一键导出完整项目 zip / 从备份导入；自动备份（关闭 / 1 / 5 / 10 / 15 / 30 / 60 分钟，有变更才备份，保留最近 20 份）+ 手动备份（可带名称）+ 备份重命名 + 加载备份（覆盖前自动快照）+ **`Ctrl/Cmd + S`** 快捷存档（任意页面 = 保存当前内容并生成本地存档；键位清单见 设置 → 快捷键）；**云端存档（WebDAV）**把备份 zip 同步到用户自己的云盘做异地副本与多设备续写（本地仍是唯一事实源；新机器可用「从云端恢复」拉回整本书）；软删内容走**回收站**（还原 / 彻底清除 + 启动一致性校验）。**备份/导出/云端的包只含三文件**：对话历史 `sessions/` 是纯本地目录（不进包、不跨机器搬运、恢复类操作不碰它）
- **AI 对话**：36 个 LLM 可见工具（查询 10 / 分析 5 / 伏笔 5 / 提案 16）+ 13 个执行类（用户确认后由服务端执行）；提案确认流程（TTL 10 分钟 + 快照重校验）；SSE = pi 会话事件投影；思维链默认折叠；**AI 只提案不写入**，正文与参考资料只有只读工具
- **AI 设置**：模型目录与凭据全部来自 pi（设置页只列已配置 provider；key 写入 pi agent dir，不入项目文件）；出站请求支持 HTTP 代理

## 文档（文档即契约）

| 目录 | 内容 |
|------|------|
| `docs/design/` | 总体设计、架构与分包、详细设计（数据模型 / 上下文 / agent 循环 / 云端存档 / 桌面版）、任务清单、配置、构建发布、遗留项 |
| `docs/api/` | 公共约定、错误码、接口索引、各模块端点契约、AI 工具目录 |
| `docs/db/` | 表结构 / outline.json / project.json 契约 |
| `docs/ui/` | **视觉与布局唯一契约**（`DESIGN.md`：色 / 字号 / 圆角 / 间距 / 三栏布局与页头结构 + antd token 登记表与守卫） |
| `test-project/` | 测试项目目录（整体不入库） |

入口顺序：`docs/design/00-master-design.md` → `architecture.md` → 详细设计 → `docs/api/00-api-index.md`；实现任何功能前先读对应文档。

## 设计原则

- **本地优先**：数据全存本地（project.json + outline.json + data.db + sessions/），本地是唯一事实源；云端存档只是备份的另一块磁盘，随时可停用（对话历史为纯本地目录，不进备份/导出/云端）
- **结构体先行**：创作要素结构化（人物 / 设定 / 地点 / 伏笔），AI 在结构上做语义分析与建议
- **AI 只提案不写入**：结构化数据写操作一律走「提案确认」；正文与参考资料 AI 只有只读工具
- **软删 + 回收站**：误删可还原，purge 才物理清除
- **不做超长正文生成 / 不做批量拆解导入**：超长文本无论怎么工程优化都绕不开上下文窗口爆满、腐化与漂移，这类产出物可信度无法自证；AI 只在作者已有结构上分析与建议（正文仍只读），要素由作者录入或导入备份

## License

[MIT](LICENSE) © 2026 whispering233
