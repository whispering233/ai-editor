# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、`hooks.md`（伏笔）、`decisions.md`（决策 1-21）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- **推进节奏**：每张卡完成后向用户汇报验证结果，用户确认后开下一张；每切片结束时演示一次端到端功能验收。
- 卡内不做卡外顺手改动；backlog.md 事项一律不做。
- 每个切片结束时功能端到端可用；切片间严格按依赖序，不跳卡。
- 契约以 `doc/api`、`doc/database` 为准，发现文档矛盾先停下提问，不要自行发明。
- 环境：Node 22.23 / pnpm 11.8（满足 Node ≥ 22.12 / pnpm 10+，workspace 需配 `allowBuilds: { better-sqlite3: true }`（pnpm 11+；pnpm 10 旧格式 `onlyBuiltDependencies`））。无 git 远端，CI 任务不做。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。

---

## 执行进度（Todo）

- [x] T0.1 pnpm monorepo 脚手架
- [x] T0.2 根脚本与静态检查
- [x] T0.3 测试框架接入（vitest）
- [x] T0.4 doc/ui 原型
- [x] T1.1 数据类型定义
- [x] T1.2 常量定义
- [x] T1.3 纯工具函数
- [x] T1.4 API 契约 Zod schema
- [x] T2.1 连接与建表
- [x] T2.2 JSON 存储模块
- [x] T2.3 对话历史数据层
- [x] T6.1 服务骨架
- [x] T7.1 客户端脚手架
- [x] T7.2 API 客户端与状态层
- [x] S1.1 schema 演进删库重建
- [x] S1.2 项目路由
- [x] S1.3 设置路由
- [x] S1.4 项目开/建页 + 设置页
- [x] S1.5 书架模式（创作根 + books/ 子目录，参考 inkos；列表端点 + Dashboard 书架）
- [x] S1.6 书架 UI 落地（卡片网格 + 封面占位 + 顶栏「书架」+ 回到书架入口）
- [x] S2.1 大纲树操作
- [x] S2.2 大纲路由
- [x] S2.3 大纲树页面
- [x] S3.1 实体 CRUD
- [x] S3.2 关系管理
- [x] S3.3 实体路由
- [x] S3.4 关系路由
- [x] S3.5 实体列表页
- [x] S3.6 实体详情/编辑页 + 关系管理 UI
- [x] S4.1 回收站数据层
- [x] S4.2 启动一致性校验
- [x] S4.3 回收站路由
- [x] S4.4 回收站页面
- [x] S5.1 Delta 增删查
- [x] S5.2 computeState
- [x] S5.3 Delta 路由
- [x] S5.4 Delta 展示
- [x] S6.1 LLM 客户端
- [x] S6.2 重试与 token
- [x] S6.3 查询类工具
- [x] S6.4 分析类工具
- [x] S6.5 伏笔工具与健康指标
- [x] S6.6 提案类工具
- [x] S6.7 执行类工具 + executor
- [x] S7.1 会话管理
- [x] S7.2 上下文组装
- [x] S7.3 主循环
- [x] S7.4 工具调度 + 提案内存仓
- [x] S7.5 提案路由
- [x] S7.6 chat SSE 路由
- [x] S8.1 聊天联调（文本流）
- [x] S8.2 提案卡接入
- [ ] S9.1 伏笔面板
- [ ] S9.2 大纲节点伏笔标记
- [ ] S10.1 画布页
- [ ] S11.1 生产构建全链路
- [ ] S11.2 端到端冒烟
- [ ] S11.3 发布前复审

---

## 阶段 A：地基（一次性基础设施，不可切片）

### 迭代 0：工程脚手架

**T0.1 pnpm monorepo 脚手架**
- 范围：`pnpm-workspace.yaml`、根 `package.json`（"type": "module"、dev 脚本）、`tsconfig.base.json`（ESM strict）、`.gitignore`；`packages/` 下 7 包空壳（shared/llm/db/tools/agent/server/client），依赖按 architecture.md 声明（shared: zod^4+nanoid^5；db: better-sqlite3^13；server: hono^4.7；client: react19+zustand5，均 `workspace:*`）
- 依赖：无
- 验证：`pnpm install` 成功；`pnpm -r build` 7 包空构建通过；`pnpm dev` 各 `tsc --watch` 能启动（可 Ctrl-C）
- 回滚：单 commit

**T0.2 根脚本与静态检查**
- 范围：根 scripts（`typecheck` = 各包 `tsc --noEmit`、`lint`）；各包 tsconfig 继承 base
- 依赖：T0.1
- 验证：`pnpm typecheck` 全绿；`pnpm lint` 全绿
- 回滚：单 commit

**T0.3 测试框架接入（vitest）**
- 范围：根接入 vitest，各包配 `test` script 与最小冒烟测试（如 shared 一个纯函数测试）
- 依赖：T0.2
- 验证：`pnpm -r test` 全绿
- 回滚：单 commit

**T0.4 doc/ui 原型（前端开发前置）**
- 范围：按页面清单（Dashboard/Outline/Canvas/EntityList/EntityDetail/Chat/HookPanel/Settings）产出 `doc/ui/layout.md` + 各页布局原型（信息层级、交互状态，不含视觉细节）
- 依赖：无（可与 T0.1-T0.3 并行）
- 验证：UI 原型与 endpoints.md 各字段一一对应（评审通过）
- 回滚：纯文档 commit

### 迭代 1：shared 包（前后端共享契约）

**T1.1 数据类型定义**
- 范围：`src/types/entity.ts`（Entity/RelationRecord/DeltaRecord）、`outline.ts`（大纲树，严格三层）、`project.ts`（ProjectConfig）、`chat.ts`（ChatMessage）——纯 TS 接口，零 Node 依赖
- 依赖：T0.1
- 验证：vitest 类型级测试 + `tsc --noEmit`；在 client 包 import 验证浏览器打包通过
- 回滚：单 commit

**T1.2 常量定义**
- 范围：`constants/entity.ts`（ENTITY_TYPES、RELATION_TYPES 含 plot_edge/plants/advances/resolves）、`hook.ts`（HOOK_STATUSES、PAYOFF_TIMING、half_life 缺省映射——决策 21）、`tool.ts`（工具权限级别、工具名常量）
- 依赖：T1.1
- 验证：vitest 断言常量集与 schema.md/tools.md 一致
- 回滚：单 commit

**T1.3 纯工具函数**
- 范围：`utils/id.ts`（nanoid + 前缀）、`format.ts`、文件↔API 字段映射函数（顶层 snake_case↔camelCase，嵌套 data 原样透传——endpoints.md 通用约定）
- 依赖：T1.1
- 验证：vitest（含嵌套 data 透传、id 前缀断言）
- 回滚：单 commit

**T1.4 API 契约 Zod schema**
- 范围：`types/api.ts`——`ErrorCode` 枚举（单一来源）+ endpoints.md 全部端点 Req/Res Zod schema（zod ^4），类型由 schema 推断
- 依赖：T1.1-T1.3
- 验证：vitest 用端点示例做 parse 通过与拒绝用例，逐端点对照 endpoints.md
- 回滚：单 commit

### 迭代 2：数据层地基

**T2.1 连接与建表**
- 范围：`connection.ts`（Database 类：open/close、事务、WAL、`PRAGMA user_version`）；`schema.ts` 建表 SQL（entities/relation_records/delta_records/chat_messages + 关系 3 索引 + chat 会话索引），时间列应用层写 ISO 8601
- 依赖：T1.4
- 验证：vitest 临时目录建库，断言表结构/索引/CHECK 约束
- 回滚：单 commit

**T2.2 JSON 存储模块**
- 范围：outline.json 整树读/原子写（临时文件 + fsync + rename，决策 11）、节点 `updated_at` 统一更新、顶层 `schema_version`；project.json 同款原子写
- 依赖：T2.1
- 验证：vitest 模拟写中断断言旧文件完好；updated_at 变更断言
- 回滚：单 commit

**T2.3 对话历史数据层**
- 范围：chat_messages 写入（session_id/project_id/role/tool_calls/tool_call_id）、会话列表（按项目隔离、倒序）、消息历史（升序）、成对重组辅助（assistant.tool_calls[].id ↔ tool.tool_call_id，孤儿半对丢弃——决策 18）
- 依赖：T2.1
- 验证：vitest 断言成对重组与孤儿丢弃
- 回滚：单 commit

### 迭代 3：服务与客户端骨架

**T6.1 服务骨架**
- 范围：`index.ts` startServer(projectRoot, port)——Hono app、统一错误包裹（`{success, data|error}` + ErrorCode）、来源校验中间件（host ∈ {127.0.0.1, localhost, ::1}，不校验端口——决策 17）、静态文件 + SPA fallback、生产态端口 +1 / dev 态报错、127.0.0.1 打开浏览器
- 依赖：T1.4、T2.1
- 验证：集成测试 app.request 断言来源校验与错误格式；起服务冒烟
- 回滚：单 commit

**T7.1 客户端脚手架**
- 范围：Vite 7 + React 19 + Tailwind 4（CSS-first）+ shadcn/ui + Zustand 5 + 自制 `useHashRoute`（不引入 React Router）+ dev proxy /api → 3456；路由骨架与全局布局
- 依赖：T0.4、T1.4
- 验证：`pnpm dev` 启动可导航；`pnpm -r build` 通过
- 回滚：单 commit

**T7.2 API 客户端与状态层**
- 范围：`lib/api.ts`（fetch 封装 + 错误码映射）、`hooks/use-api.ts`、Zustand stores（project/ui）、`hooks/use-sse.ts`（fetch + ReadableStream 自写 SSE：跨 chunk data: 拼接、注释行跳过、error 终止、60s 无事件提示断开——决策 20）
- 依赖：T7.1
- 验证：use-sse 单测（分片拼接/注释/error）；api 层 mock fetch 单测
- 回滚：单 commit

---

## 阶段 B：功能垂直切片

### 切片 1：项目管理（验收：能创建/打开项目、改配置、配模型 key）

**S1.1 schema 演进删库重建**
- 范围：open 时 `user_version` 判定 → 不匹配删库重建（备份 `data.db.v{n}.bak` + `outline.json.v{n}.bak`，重置 outline.json 与回收站——决策 13）；project.json 的 schema_version 仅判 JSON
- 依赖：T2.1、T2.2
- 验证：vitest 构造旧版本库断言重建与备份文件
- 回滚：单 commit

**S1.2 项目路由**
- 范围：create/open/close/config（GET/PUT）——路径校验（规范化、拒绝逃逸/符号链接出目录、INVALID_PROJECT_PATH）、open 触发 S1.1 重建、current_position 读写（须指向非软删节点）
- 依赖：S1.1、T6.1
- 验证：集成测试含路径逃逸拒绝用例
- 回滚：单 commit

**S1.3 设置路由**
- 范围：GET/PUT /settings/llm——读取优先级 环境变量 `DEEPSEEK_API_KEY` > `~/.ai-editor/config.json`、掩码展示、写入用户级配置（绝不入项目文件——决策 17）
- 依赖：T6.1
- 验证：集成测试（临时 HOME 隔离）
- 回滚：单 commit

**S1.4 项目开/建页 + 设置页**
- 范围：项目路径输入/创建/打开（INVALID_PROJECT_PATH/重建提示）、设置页（模型名、API key 掩码编辑）
- 依赖：T7.2、S1.2、S1.3
- 验证：手工走查 + 构建通过
- 回滚：单 commit

### 切片 2：大纲（验收：树页面可增删改移，拖拽生效并落盘）

**S2.1 大纲树操作**
- 范围：创建（严格三层 + parent_id 必填）、更新、move（三层约束 + order 重排 + updated_at）、软删递归（级联计数）、还原祖先链校验（409 OUTLINE_ANCESTOR_DELETED）、路径查询、章节序推导（决策 21：全局章序号、scene 归入所属章）
- 依赖：T2.2
- 验证：vitest 全操作断言（含畸形树 409、move 后章节序刷新）
- 回滚：单 commit

**S2.2 大纲路由**
- 范围：GET 整树（with_metadata 联查统计）、POST 创建、PUT 更新、PUT move、DELETE 软删递归、GET path
- 依赖：S2.1
- 验证：集成测试含非法 parent 400
- 回滚：单 commit

**S2.3 大纲树页面**
- 范围：整树渲染、节点创建（父节点选择按类型过滤）、编辑标题/摘要、拖拽 move、软删、current_position 设置
- 依赖：T7.2、S2.2
- 验证：手工走查全操作 + 刷新后数据保持
- 回滚：单 commit

### 切片 3：实体与关系（验收：四类实体 CRUD + 关系查询创建删除）

**S3.1 实体 CRUD**
- 范围：增删改查 + 软删级联（关系/Delta 计数）+ 常规查询过滤软删 + 分页/搜索/排序摘要
- 依赖：T2.1
- 验证：vitest fixture 库全用例（含级联计数、过滤）
- 回滚：单 commit

**S3.2 关系管理**
- 范围：k 跳遍历（depth 1/2/3 + 路径组装）、端点可见性校验（含大纲节点软删联动）、级联软删、手动删除物理删、RELATION_EXISTS 判重
- 依赖：S2.1、S3.1
- 验证：vitest 建实体+关系图断言 1/2/3 跳与可见性
- 回滚：单 commit

**S3.3 实体路由**
- 范围：GET 列表（q/offset/limit/sort/order + EntitySummary）、GET 详情（+relations + deltaCount）、POST（VALIDATION_ERROR）、PUT 部分更新、DELETE 软删级联
- 依赖：S3.1
- 验证：集成测试逐端点 + 契约 parse 校验
- 回滚：单 commit

**S3.4 关系路由**
- 范围：GET 查询（depth 1-3）、POST 创建（RELATION_EXISTS 409）、DELETE 物理删（404）
- 依赖：S3.2
- 验证：集成测试
- 回滚：单 commit

**S3.5 实体列表页**
- 范围：四类 tab（人物/设定/地点/伏笔）、搜索分页、摘要字段展示
- 依赖：T7.2、S3.3
- 验证：手工走查
- 回滚：单 commit

**S3.6 实体详情/编辑页 + 关系管理 UI**
- 范围：详情（data 字段表单按类型、relations 1 跳展示、deltaCount）、创建/更新/软删；关系列表创建/删除
- 依赖：S3.5、S3.4
- 验证：手工走查
- 回滚：单 commit

### 切片 4：回收站（验收：软删对象可还原/彻底清除，一致性兜底生效）

**S4.1 回收站数据层** ✅（f28b710，经 oracle 审核放行）
- 范围：列表（entities+nodes 按 deleted_at 排序）、restore 级联还原（本体 + 关系 + Delta + 子节点；祖先软删 409）、purge 物理清除（节点递归子树）、还原后端点仍软删关系暂不可见
- 依赖：S2.1、S3.1、S3.2
- 验证：vitest 全流程用例（db 137 全绿 +12）
- 回滚：单 commit

**S4.2 启动一致性校验** ✅（6c332e6 + ef834e7，经 oracle 审核放行；方向经用户裁决：以大纲节点软删为准补标 DB 关联记录）
- 范围：打开项目比对 outline.json 节点软删与 relation/delta 软删，以大纲节点软删为准补标 DB 记录并写日志（决策 16 修订，方向 2026-08 裁决）
- 依赖：S4.1
- 验证：vitest 构造不一致 fixture 断言补标（server 132 全绿 +6）
- 回滚：单 commit

**S4.3 回收站路由** ✅（167a944 + b6fe52c，经 oracle 审核放行）
- 范围：GET 列表（entities 填充）、restore 实体/节点（409 OUTLINE_ANCESTOR_DELETED）、purge 实体/节点（未软删 400 拦截）
- 依赖：S4.1
- 验证：集成测试全流程（server 138 全绿 +6）
- 回滚：单 commit

**S4.4 回收站页面** ✅（f6e11e3 + 0d5de66，经 oracle 审核放行；修复：还原/purge 大纲节点后联动刷新 project store outline——大纲 tab 无需手动刷新 b4d3e14）
- 范围：列表（实体/节点分栏）、restore（409 祖先行内提示 + 还原上级解链）、purge（确认框「确认彻底删除」）；**接入三栏布局**——中栏 tab「回收站」（`#/trash`，layout.md §1，2026-08 修订）
- 依赖：S3.5、S4.3
- 验证：client 179 全绿 +7；手工走查
- 回滚：单 commit

### 切片 5：Delta（验收：可记录变更、查看历史、计算到达状态）

**S5.1 Delta 增删查** ✅（7dd5207，经 oracle 审核放行；含坏行防御/脏引用测试）
- 范围：插入（order 服务端全局单调生成）、按节点查询（联表 target_name）、级联软删、可见性联动（触发节点/目标实体任一软删不可见）
- 依赖：S2.1、S3.1
- 验证：vitest 断言 order 递增与可见性（db 147 全绿 +10）
- 回滚：单 commit

**S5.2 computeState** ✅（633d0e4，经 oracle 审核放行；深拷贝断言按审核建议补齐）
- 范围：根→at_node 树路径收集 + 双层排序（节点间树路径序、节点内 order）；op 语义 set/update/add/remove；update from 校验失败 → 跳过 + skipped/conflicts 标注（不抛 409——决策 9 修订）；plot_edge 不参与；软删过滤
- 依赖：S2.1、S5.1
- 验证：vitest 覆盖四 op、冲突跳过、双层排序、软删过滤（db 159 全绿 +12）
- 回滚：单 commit

**S5.3 Delta 路由** ✅（a25e0aa，经 oracle 审核放行；to/value 契约注释随卡修正——endpoints.md/api.ts/entity.ts）
- 范围：POST 追加、GET /node/:nodeId、POST /compute（含 conflicts 返回；OUTLINE_NODE_NOT_FOUND）；路由层补节点存在校验（防死记录）+ per-op 必填校验
- 依赖：S5.2
- 验证：集成测试含冲突场景（server 155 全绿 +17）
- 回滚：单 commit

**S5.4 Delta 展示** ✅（e305e4b，经 oracle 审核放行；修补：EntityDetail key 防跨实体残留 + 大纲操作条 token 统一 + 404 防御分支注释）
- 范围：大纲节点/实体详情内 Delta 列表与变更摘要、compute 状态预览（含 conflicts 标注）
- 依赖：S3.6、S5.3
- 验证：手工走查冲突场景（client 197 全绿 +18；端到端走查清单见卡内交付）
- 回滚：单 commit

### 切片 6：模型与工具层（验收：工具目录全部注册、权限分级正确、测试全绿）

**S6.1 LLM 客户端** ✅（73e3291，经 oracle 审核放行）
- 范围：`client.ts`（fetch → DeepSeek、流式 SSE 解析、模型名可配置、key 注入源）、`types.ts`。SSE 解码器细节（2026-08 补充，借鉴 pi）：跨 chunk `data:` 行拼接、注释行跳过、`[DONE]` 哨兵校验（**流中途终止无 `[DONE]` = 错误**）、**逐 chunk 检查 abort signal**；流式 tool_call 参数按 index 累积增量片段、结束收尾 parse；错误响应归一化（status/code/message，body 截断）
- 依赖：T1.4
- 验证：mock fetch 单测（流式分片、错误响应、**流中途终止无 [DONE] → 错误路径**、abort 中断）；无 key 可全测
- 回滚：单 commit

**S6.2 重试与 token** ✅（11d5f16，经 oracle 审核放行）
- 范围：`retry.ts`（429/5xx/超时退避重试）、`token.ts`（估算）、工具结果 token 截断（决策 15）。重试分类（2026-08 补充，借鉴 pi）：**配额/计费类（402/insufficient_quota/billing）不可重试快失败**，传输类（429/5xx/超时/网络断开）指数退避 `base*2^(n-1)`（参考默认 maxRetries=3、base=2s）；**abort 永不重试**，退避 sleep 监听 abort；token 估算 chars/4 + 优先最近一次成功响应的真实 usage
- 依赖：S6.1
- 验证：vitest mock 断言重试次数与退避、**配额错误不重试**、估算边界
- 回滚：单 commit

**S6.3 查询类工具** ✅（4aca950，经 oracle 审核放行）
- 范围：registry + get_entity / search_entities / query_relationships / get_outline / get_outline_path / compute_state / get_delta_history / get_entity_summary（自动权限、过滤软删）
- 依赖：S3.2、S5.2、S2.1
- 验证：vitest fixture 库逐一断言返回结构
- 回滚：单 commit

**S6.4 分析类工具** ✅（e4a6296，经 oracle 审核放行）
- 范围：analyze_consistency / detect_conflicts / trace_plot_paths / find_orphan_elements（含 inconsistent_soft_deletes）/ suggest_connections
- 依赖：S6.3
- 验证：vitest 构造已知矛盾/孤立 fixture 断言检出
- 回滚：单 commit

**S6.5 伏笔工具与健康指标** ✅（d425d4e，经 oracle 审核放行）
- 范围：analyze_hook_health / trace_hook_lifecycle / suggest_hook_payoff / find_hook_opportunities / detect_hook_conflicts；`_health` 运行时计算（age/dormancy/stale/overdue/ready_to_resolve/blocked——决策 21 口径：current_position 章节序、half_life 缺省映射、expected_resolve_node_id 未设置不猜测），绝不写回 data
- 依赖：S2.1、S6.3
- 验证：vitest 构造伏笔生命周期 fixture 断言全部指标；断言 data 未写回
- 回滚：单 commit

**S6.6 提案类工具** ✅（d5c0f90，经 oracle 审核放行）
- 范围：propose_create/update/delete_entity、propose_add/remove_relation、propose_add_delta、propose_outline/move/delete_node、propose_create/update/advance/resolve/abandon_hook——仅产出提案对象（含 project_id），tool_result 不含预览细节
- 依赖：S6.3
- 验证：vitest 断言提案结构、不落盘、无预览
- 回滚：单 commit

**S6.7 执行类工具 + executor** ✅（ba0a6fe，经 oracle 审核放行）
- 范围：create/update/delete_entity、add/remove_relation、add_delta、create/move/delete_outline_node、advance_hook/resolve_hook/abandon_hook 复合写（delta+relation 一次提交、幂等按 (node_id, hook_id, relation_type) 判重）
- 依赖：S3.1-S4.1、S6.6
- 验证：vitest 断言复合写原子性与幂等
- 回滚：单 commit

### 切片 7：对话服务（验收：SSE 流、心跳断连、提案确认全链路服务端就绪）

**S7.1 会话管理** ✅（8cb278d，经 oracle 审核放行）
- 范围：`session.ts` 历史维护、滑动窗口成对裁剪（tool_call/tool_result 同裁同留）、历史重建喂回格式（决策 18）；**重试/续聊末条约束**（2026-08 补充，借鉴 pi）：喂回序列末条必须 user/tool，失败轮半条 assistant 不喂回，重试复用原 payload
- 依赖：T2.3
- 验证：vitest mock 消息序列断言成对裁剪与孤儿丢弃、**重试 payload 不含失败轮半条**
- 回滚：单 commit

**S7.2 上下文组装** ✅（25f8c5f，经 oracle 审核放行）
- 范围：`context.ts` 三层提示词注入（决策 7）+ 聚焦上下文（focus_entity/node）+ 工具列表注入 + token 预算；**usage 基线**（2026-08 补充，借鉴 pi）：优先最近真实 usage，**裁剪历史后重置基线**（决策 6）
- 依赖：S7.1
- 验证：vitest 断言上下文结构与预算截断、**裁剪后预算不漂移**
- 回滚：单 commit

**S7.3 主循环** ✅（123e69d，经 oracle 审核放行）
- 范围：`run.ts` runAgent()——8 轮/120s/token 三重保险（决策 15）、工具失败结构化喂回自纠、模型失败重试、SSE 事件序列（tool_call/tool_result/proposal/text/done/error，proposal 在 tool_result 后、循环继续前）；**length 截断不执行任何 tool_call 全部标错重发**、**重试与轮次分开计量、120s 含重试退避**（2026-08 补充，借鉴 pi）；**超时信号与用户取消分离**（决策 15 超时可重试 vs 决策 16 取消不重试——单次 attempt 超时须独立 signal 并映射为可重试错误，勿将 AbortSignal.timeout 直挂用户取消链路）；**abort 双形态归一化**（chatStream 流中返回 `{ok:false, aborted}` vs withRetry 抛 `ABORT_ERROR`，主循环包 helper 归一双通道）（ora S6.2 审核 2026-08）
- 依赖：S6.7、S7.2
- 验证：vitest mock LLM 固定响应断言终止条件与事件顺序、**finish_reason=length 用例**、**半条 assistant 不重发用例**
- 回滚：单 commit

**S7.4 工具调度 + 提案内存仓** ✅（de6d717，经 oracle 审核放行）
- 范围：`executor.ts` 收到 LLM tool_call → 调度 query/analysis/proposal；提案仓（TTL 10 分钟 + 条数上限 + project_id 绑定，切换项目清空——决策 14 修订）；**批量 tool_call 先全部校验再执行、错误统一结构化回填、执行中检查取消 signal**（2026-08 补充，借鉴 pi）
- 依赖：S6.6、S7.3
- 验证：vitest 假时钟断言 TTL 过期与上限淘汰；调度错误路径；**批量校验 fail fast**
- 回滚：单 commit

**S7.5 提案路由** ✅（2fa0061，经 oracle 审核放行）
- 范围：confirm/reject——快照重校验（存在性 + updated_at，大纲节点用节点级 updated_at）、409 PROPOSAL_STALE / 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH
- 依赖：S7.4
- 验证：集成测试含快照过期场景
- 回滚：单 commit

**S7.6 chat SSE 路由** ✅（77eb11a，经 oracle 审核放行）
- 范围：POST /chat（SSE 流：ping 15-30s 心跳 + 六类事件）、三路断开检测（onAbort + req close/error + 心跳写失败）、全链路取消（AbortController 终止 agent + DeepSeek fetch）；**取消信号四层穿透**（fetch signal / SSE 读循环逐 chunk / 工具执行 / 重试 sleep——2026-08 补充，借鉴 pi）。**会话列表/历史端点已由 U3 实现**（GET /chat/sessions、GET /chat/sessions/:id/messages，2026-08 标注——本卡不再重复）
- 依赖：S7.5
- 验证：集成测试读取 SSE 流断言事件序列；模拟断开断言取消（**含四层穿透各环节**）；心跳间隔断言
- 回滚：单 commit

### 切片 8：聊天联调（验收：能对话、能看流式回复、能处理断连）

> 2026-08 修订：**聊天 UI 已由 U5 完成**（右栏 ChatPanel：消息流/输入区/focus 小条/断连横幅/提案卡 UI，UI 先行决策）——本切片不再实现 UI，改为 S7 后端就绪后的联调与真实数据接入；接入点清单见 U5 卡报告。

**S8.1 聊天联调（文本流）** ✅（42c692b，经 oracle 审核放行）
- 范围：接 S7.6 真实 SSE 流联调——消息流/输入区/断连重发（U5 已实现），验证事件映射（text/tool_call/tool_result/done/error）、流式文本追加、断连横幅与 resendLast；**服务端调试日志已就绪（.ai-editor/config.json 配置文件，2026-08 独立交付 f9ad793）——联调时开启可观察 [chat] 事件序列**
- 依赖：U5、S7.6
- 验证：stub SSE 事件序列走查；有 key 则真实对话冒烟
- 回滚：单 commit

**S8.2 提案卡接入** ✅（bae6d78，经 oracle 审核放行）
- 范围：提案卡 UI（U5 已就绪）接 S7.5 confirm/reject 真实调用——解锁按钮 + 状态迁移（pending→confirmed/rejected）、PROPOSAL_STALE 失效提示与重新生成引导、PROPOSAL_NOT_FOUND 移除卡片
- 依赖：S8.1、S7.5
- 验证：stub 走查三种错误码呈现
- 回滚：单 commit

### 切片 9：伏笔面板（验收：伏笔池全生命周期 + 健康指标呈现）

**S9.1 伏笔面板**
- 范围：伏笔池列表（活跃/已回收分组）、健康指标徽标（_health 附加字段）、创建/推进/回收/废弃操作入口（走提案流程）、依赖链展示；**接入三栏布局**——中栏 tab「伏笔」（`#/hooks`，layout.md §1，2026-08 修订）
- 依赖：S8.2、S6.5
- 验证：构造伏笔 fixture 走查全部指标呈现
- 回滚：单 commit

**S9.2 大纲节点伏笔标记**
- 范围：大纲/画布节点上 plants/advances/resolves 标记展示
- 依赖：S9.1、S2.3
- 验证：手工走查
- 回滚：单 commit

### 切片 10：画布（验收：节点拖拽、连线、布局持久化）

**S10.1 画布页**
- 范围：大纲节点画布投影、拖拽定位（坐标/缩放存 localStorage，按 project_id 隔离）、plot_edge 连线创建/删除（连线标签）；**接入三栏布局**——中栏 tab「画布」（`#/canvas`，layout.md §1，2026-08 修订）
- 依赖：S2.3、S3.4
- 验证：手工走查（刷新后布局保持）
- 回滚：单 commit

### 切片 12：大纲节点详情与结构化信息（2026-08 用户反馈，决策 23）

> 依据：`decisions.md` 决策 23（麦基《故事》字段集——场景 goal/conflict_levels/value_from/value_to、章 reversal/climax_scene、卷 climax_scene/inciting_scene；载体 = outline.json 节点 data，与实体 data 同构）；`schema.md` outline.json 契约；`endpoints.md` 大纲端点（GET 返回 data、POST/PUT 支持 data）；`doc/ui/pages/outline.md` 详情页文档。验收：大纲节点详情页可编辑标题/摘要/结构化 data、查看变更记录与相关实体；变更记录可在详情页创建。

**S12.1 节点 data 后端** ✅（1be9c4f，经 oracle 审核放行；含空对象浅合并语义锁定测试）
- 范围：shared——`OUTLINE_NODE_DATA_SCHEMAS`（volume/chapter/scene 三层 zod schema，决策 23 字段集；scene：goal/conflict_levels/value_from/value_to；chapter：reversal/climax_scene；volume：climax_scene/inciting_scene）+ `OutlineFileNode`/`OutlineNode` 类型加 `data?` + 大纲端点 schema 更新（POST/PUT 支持 data、GET 返回 data）；db——outline 读写层 data 透传 + outline-ops create/update 支持 data（部分合并 + touch updated_at）；server——outline 路由（POST/PUT data 按层级 schema 校验 → 400 VALIDATION_ERROR）
- 依赖：S2.1、决策 23
- 验证：vitest 断言 data 透传/校验/部分合并（shared 84 / db 164 / server 161 全绿）
- 回滚：单 commit

**S12.2 节点详情页** ✅（c6e17be，经 oracle 审核放行；ora-6/ora-7 两次空返回后 orchestrator 直接验证）
- 范围：`#/outline/:nodeId` 中栏二级路由（仿实体详情）；面包屑 + 类型徽标 + 元信息；基本信息（title/summary 表单编辑）；data 字段表单（按层级渲染，引用字段用场景节点选择器）；变更记录列表（自 S5.4 行内面板迁入）；相关实体（relations-view 复用，可建立关系）；伏笔标记占位（S9 后）；大纲页 ⋯ 菜单「变更记录」→「详情」+ 行内面板移除；layout.md 路由表 + pages/outline.md 更新
- 依赖：S12.1、S5.3（delta 端点）、U8（relations-view）
- 验证：typecheck + lint + client test（205 全绿）+ 手工走查（data 编辑/引用跳转/变更记录展示）
- 回滚：单 commit

**S12.3 变更记录创建入口** ✅（ab4fff4，经 orchestrator 直接验证；含 schema 编译期断言测试）
- 范围：详情页「+ 新建变更」表单——目标实体（类型下拉 + 搜索选择，含大纲节点）、字段选择（按目标类型 schema 下拉 + 自定义兜底）、op（set/update/add/remove，数组字段推断 add/remove）、值输入（**update 的 from 自动取实体当前 data 值**——决策 9 修订 conflicts 机制兜底断裂）、描述必填 → POST /delta → toast + 列表刷新
- 依赖：S12.2、S5.3
- 验证：typecheck + lint + client test（227 全绿）+ 手工走查创建流程
- 回滚：单 commit

### 切片 13：大纲交互重构（2026-08 用户反馈）

> 用户反馈（2026-08）：大纲页操作区冗杂（⋯ 菜单/重复新建入口/意义不明的「设为当前位置」）、同级拖拽排序不可用、摘要显示不充分、大纲页底部回收站折叠区冗余；节点结构化信息不应出现在变更记录目标类型中（节点代表的故事导致实体变更）。决策经逐项确认：⋯ 取消操作平铺图标化；「设为当前位置」迁入节点详情页；拖拽上下半判定 + 指示线；摘要标题下方独立行；回收站折叠区删除；变更记录目标类型前后端均禁止 outline_node。

**S13.1 大纲页交互重构** ✅（b61d4b6，经 oracle 审核放行；oracle M1 同父重排 off-by-one 修补轮）
- 范围：Outline.tsx——取消 ⋯ 操作条（行尾平铺：＋ 就地新建 + 详情图标 + 移入回收站图标，带确认）；删除「新建子节点」「移动到…」「设为当前位置」入口；**拖拽上下半判定 + 插入指示线**（上半=插前、下半=插后，同级排序可用，跨父移动按 canMoveTo 过滤）；摘要移到**标题下方独立行**（默认显示、空不显示、点击就地编辑保留）；删除大纲页底部回收站折叠区（Trash tab 已覆盖）；当前位置徽标 amber 硬编码 → token 类；doc/ui/pages/outline.md + layout.md 同步
- 依赖：S2.3、S12.2（详情页已存在，图标跳转目标）
- 验证：typecheck + lint + client test + 手工走查（拖拽排序/图标操作/摘要两行/回收站区移除）
- 回滚：单 commit

**S13.2 设为当前位置迁入详情页** ✅（1d5eba9，经 oracle 审核放行）
- 范围：OutlineDetail.tsx 加「设为当前位置」按钮（PUT /project/config；已是当前位置则禁用/标记）；大纲页入口由 S13.1 移除；InfoBar/行尾徽标/compute 预览默认节点/S9 依赖全部保留；doc/ui 同步
- 依赖：S13.1
- 验证：typecheck + lint + client test + 手工走查（详情页标记 → InfoBar/徽标联动）
- 回滚：单 commit

**S13.3 变更记录目标类型收紧** ✅（6df1eaa，经 oracle 审核放行）
- 范围：前端——`DELTA_TARGET_TYPE_OPTIONS` 去掉「大纲节点」、默认目标改为空（需选择实体）、删除 `nodeDeltaFieldOptions` 节点字段选项逻辑；后端——POST /delta 路由校验 `target_type` 不含 outline_node → 400 VALIDATION_ERROR（server delta.ts + 测试）；契约——endpoints.md 注明 POST /delta target_type 仅实体类型；**历史 outline_node 目标 Delta 保留展示**（listDeltasByNode/computeState 既有行为不变）
- 依赖：S12.3、S5.3
- 验证：typecheck + lint + client/server test + 手工走查（表单无大纲节点选项、POST 非法 target_type 400）
- 回滚：单 commit

**S13.4 概览页引导形态修复（用户反馈：有书仍显示「还没有书」）** ✅（3430472，经 oracle 审核放行）
- 范围：Dashboard.tsx 引导形态（noProject）改造——书架有书（books.length > 0）时引导卡**直接列出书籍**（书名 + 更新时间，点击 openProjectAt 打开）+ 底部「新建一本」次级入口；空书架才显示「还没有书，先创建一本」+ 新建表单；加载中骨架；加载失败保留错误 + 重试；doc/ui/pages/dashboard.md 引导形态描述同步
- 依赖：U4、S1.5
- 验证：typecheck + lint + client test + 手工走查（test-project 有书启动 → 概览页列出书籍点击打开；空书架 → 创建引导）
- 回滚：单 commit

---

## 阶段 U：UI 工作台重构（三栏布局，2026-08，决策 22）

> 依据：`doc/ui/layout.md`（2026-08 重写：三栏 1:5:4 固定、中栏 6 tab、右栏聊天常驻、主题系统契约）；验收：三栏工作台可完整使用，双主题可切换，聊天常驻右栏且会话归属项目。

**U1 shadcn 集成 + 主题 tokens** ✅（8357190，经 oracle 审核放行）
- 范围：`components.json`（base-nova / cssVariables / aliases `@`）+ client tsconfig/vite.config 配 `@` 别名 + 装 lucide-react 与 shadcn 依赖（CLI 入 devDependencies，2026-08 实现修订）；`index.css` 重写（`@custom-variant dark` + `@theme inline` + `:root`/`.dark` oklch 双主题 tokens（暖羊皮纸+牛血红+金箔 ↔ 蓝黑曜石+琥珀烛光）+ 系统字体栈 + `--radius: 0.6rem` + `color-scheme`）；shadcn add 基础组件（button/input/dialog/dropdown-menu/tabs/sonner/separator/tooltip 等）**替换自研 button/input/modal 三件套并迁移全部调用点**；`useTheme` hook（localStorage `ai-editor:theme` + classList toggle）；删除未使用的 `@fontsource-variable/geist`（系统字体栈，不下载 web 字体）
- 依赖：T7.1
- 验证：typecheck + lint + vitest 全绿；双主题手动切换走查
- 回滚：单 commit

**U2 三栏外壳 AppShell** ✅（22b7758，经 oracle 审核放行；Chat.tsx 死文件删除、Escape/焦点管理留 U5）
- 范围：AppShell 拆三栏（flex 1:5:4 固定，左右不可拖拽）——Sidebar / MainPanel（信息条：项目名/当前位置/语言 + TabBar 6 tab：概览|大纲|画布|实体关系|伏笔|回收站，药丸分段控件）/ ChatPanel 骨架；`<1024px` 右栏折叠为抽屉（useMediaQuery + 开关）；路由对齐（`#/chat` 移除、settings 归左栏，layout.md §1）
- 依赖：U1
- 验证：typecheck/lint/test + 手工走查各路由三栏渲染与抽屉
- 回滚：单 commit

**U3 左栏 Sidebar（书架 + 会话树）** ✅（1ce5bb4，经 oracle 审核放行；L1/L2/L4 记后续）
- 范围：产品标识（点击回 `#/`）；书架树：项目行（`GET /project/list`，书名+更新时间）chevron 展开会话列表（`GET /chat/sessions`，点击 → 右栏切换会话并恢复历史）；打开项目（openProjectAt）、新建项目入口；底部设置入口 + 主题切换按钮；无项目态
- 依赖：U2
- 验证：手工走查书架展开/会话切换/打开项目
- 回滚：单 commit

**U4 中栏 TabBar + 概览页** ✅（3c27254，经 oracle 审核放行；M1 补 AI 入口/M2 book-cover 注释/L1 formatRelativeTime 抽 shared/L2 首帧骨架/L3 切项目清 focus/L4 新建 toast 均已处理）
- 范围：TabBar 6 tab 高亮（路由首段驱动，实体列表/详情共用高亮）；概览页 `#/`（原 Dashboard 概览形态移入：项目信息/四类统计/大纲概览/最近会话 + 无项目引导态：新建/打开表单，dashboard.md）；信息条当前位置点击 → `#/outline` 定位
- 依赖：U2
- 验证：手工走查 + vitest 更新
- 回滚：单 commit

**U5 右栏 ChatPanel（常驻聊天）** ✅（c1e1bd6，经 oracle 审核；UI 先行/发送接 S7，S7 接入点清单见报告）
- 范围：会话标题行（下拉切换同项目会话 + [+ 新会话]）；消息流（user 气泡/assistant 排版）、工具调用折叠记录、提案卡（`border-primary/25 bg-primary/5` 双按钮锁定态）、focus 小条（跨页「问 AI」注入 context，layout.md §4.2）、断连横幅、无项目禁用态；`pages/Chat.tsx` 占位页移除；chat store 扩展 `currentProjectId` + `currentSessionId`
- 依赖：U2、U3
- 验证：手工走查 SSE 发送/流式/提案确认/断连 + 会话切换
- 回滚：单 commit

**U6 全局反馈组件（toast 渲染 + 错误横幅）** ✅（af7c3f2 + 3c50177，经 oracle 审核放行）
- 背景：ui store 的 `showToast`/`showError` 已有多个调用点（实体创建/保存/删关系/软删、新建项目、设置保存），但 AppShell 从未渲染反馈——操作成功/失败均无提示（用户反馈）。
- 范围：新增 `components/feedback/`——`FeedbackHost`（挂 AppShell：sonner `<Toaster />` + 订阅 ui store `toast` → sonner `toast()` 桥接（kind success/error 映射，主题随 useTheme）+ `ErrorBanner` 渲染 ui store `error` 红色横幅（`bg-destructive/10 border-destructive/30 text-destructive` + 关闭按钮））；现有 `showToast`/`showError` 调用点零改动；layout.md §4.1/§4.3 同步（已更新）
- 依赖：U2
- 验证：typecheck + lint + vitest 全绿；手工走查创建实体/保存/删关系/软删/新建项目均出现 toast、设置保存失败出现错误横幅
- 回滚：单 commit

**U7 详情页面包屑导航** ✅（6466446 + 1435316，经 oracle 审核放行）
- 背景：实体详情页（三级）无返回上级入口，深页面容易迷失（用户反馈）。
- 范围：新增共用组件 `components/page-nav/Breadcrumb.tsx`（tab 化分段，样式与列表页类型 tab 一致）；EntityDetail header 替换原类型徽标为「实体 › 人物 › 张三」——「实体」「人物」可点击返回列表（`#/entities/character`），当前实体名不可点高亮；entity-detail.md 同步（已更新）
- 依赖：U6（可选，无强依赖）
- 验证：typecheck + lint + vitest 全绿；手工走查详情页面包屑逐级返回
- 回滚：单 commit

**U8 关联 tab（实体关系总览）** ✅（0366fd3 + 7346c2e，经 oracle 审核放行；优化：建立关联对话框左右布局「源 —关系→ 目标」c61d354；根因修复：DialogContent 基座 `max-w-lg`（原 `sm:max-w-sm` 压掉全仓覆盖致对话框静默 384px）f653058）
- 背景：建立关联必须进入详情页点击条目，列表层无关系总览与快捷建立入口（用户反馈）。
- 范围：`#/entities/relations` 第 5 个 tab（main.tsx 实体分支拦截 `relations` 段）——关联列表（`GET /relation?depth=1`，端点类型/关系类型下拉过滤 + 名称前端过滤）、行内 [删除]（ConfirmDialog 物理删确认）、端点名点击跳详情；「+ 新建」在关联 tab 下变「+ 建立关联」——抽 `CreateRelationDialog` 为共用组件（`components/entity/create-relation-dialog.tsx`），列表模式暴露源实体选择（类型+实体），详情页模式源固定当前实体（原行为不变）；entity-list.md 同步（已更新）
- 依赖：U6（toast 反馈）
- 验证：typecheck + lint + vitest 全绿；手工走查关联 tab 过滤/建立（含 RELATION_EXISTS）/删除/跳详情 + 详情页新增关联回归
- 回滚：单 commit

---

**S11.1 生产构建全链路**
- 范围：`pnpm -r build` → `node packages/server/dist/index.js` 启动（项目初始化、SPA fallback、端口 +1、127.0.0.1 打开浏览器）
- 依赖：全部切片
- 验证：真实目录起服务走查核心流程
- 回滚：单 commit

**S11.2 端到端冒烟**
- 范围：脚本化走查核心链路（建项目 → 建大纲 → 建实体 → 建关系 → Delta → 回收站 → 伏笔 → 对话）
- 依赖：S11.1
- 验证：脚本全绿
- 回滚：单 commit

**S11.3 发布前复审**
- 范围：backlog #12 schema 演进复审、#2 导出/导入、#8 全局安装演练、#4 token 统计评估
- 依赖：S11.2
- 验证：评审纪要产出
- 回滚：单 commit
