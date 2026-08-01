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
- [ ] T0.4 doc/ui 原型
- [ ] T1.1 数据类型定义
- [ ] T1.2 常量定义
- [ ] T1.3 纯工具函数
- [ ] T1.4 API 契约 Zod schema
- [ ] T2.1 连接与建表
- [ ] T2.2 JSON 存储模块
- [ ] T2.3 对话历史数据层
- [ ] T6.1 服务骨架
- [ ] T7.1 客户端脚手架
- [ ] T7.2 API 客户端与状态层
- [ ] S1.1 schema 演进删库重建
- [ ] S1.2 项目路由
- [ ] S1.3 设置路由
- [ ] S1.4 项目开/建页 + 设置页
- [ ] S2.1 大纲树操作
- [ ] S2.2 大纲路由
- [ ] S2.3 大纲树页面
- [ ] S3.1 实体 CRUD
- [ ] S3.2 关系管理
- [ ] S3.3 实体路由
- [ ] S3.4 关系路由
- [ ] S3.5 实体列表页
- [ ] S3.6 实体详情/编辑页 + 关系管理 UI
- [ ] S4.1 回收站数据层
- [ ] S4.2 启动一致性校验
- [ ] S4.3 回收站路由
- [ ] S4.4 回收站页面
- [ ] S5.1 Delta 增删查
- [ ] S5.2 computeState
- [ ] S5.3 Delta 路由
- [ ] S5.4 Delta 展示
- [ ] S6.1 LLM 客户端
- [ ] S6.2 重试与 token
- [ ] S6.3 查询类工具
- [ ] S6.4 分析类工具
- [ ] S6.5 伏笔工具与健康指标
- [ ] S6.6 提案类工具
- [ ] S6.7 执行类工具 + executor
- [ ] S7.1 会话管理
- [ ] S7.2 上下文组装
- [ ] S7.3 主循环
- [ ] S7.4 工具调度 + 提案内存仓
- [ ] S7.5 提案路由
- [ ] S7.6 chat SSE 路由
- [ ] S8.1 聊天页（文本流）
- [ ] S8.2 提案卡片
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

**S4.1 回收站数据层**
- 范围：列表（entities+nodes 按 deleted_at 排序）、restore 级联还原（本体 + 关系 + Delta + 子节点；祖先软删 409）、purge 物理清除（节点递归子树）、还原后端点仍软删关系暂不可见
- 依赖：S2.1、S3.1、S3.2
- 验证：vitest 全流程用例
- 回滚：单 commit

**S4.2 启动一致性校验**
- 范围：打开项目比对 outline.json 节点软删与 relation/delta 软删，以 DB 为准补标并写日志（决策 16 修订）
- 依赖：S4.1
- 验证：vitest 构造不一致 fixture 断言补标
- 回滚：单 commit

**S4.3 回收站路由**
- 范围：GET 列表、restore 实体/节点（409 OUTLINE_ANCESTOR_DELETED）、purge 实体/节点
- 依赖：S4.1
- 验证：集成测试全流程
- 回滚：单 commit

**S4.4 回收站页面**
- 范围：列表（实体/节点分栏）、restore（409 祖先提示）、purge
- 依赖：S3.5、S4.3
- 验证：手工走查
- 回滚：单 commit

### 切片 5：Delta（验收：可记录变更、查看历史、计算到达状态）

**S5.1 Delta 增删查**
- 范围：插入（order 服务端全局单调生成）、按节点查询（联表 target_name）、级联软删、可见性联动（触发节点/目标实体任一软删不可见）
- 依赖：S2.1、S3.1
- 验证：vitest 断言 order 递增与可见性
- 回滚：单 commit

**S5.2 computeState**
- 范围：根→at_node 树路径收集 + 双层排序（节点间树路径序、节点内 order）；op 语义 set/update/add/remove；update from 校验失败 → 跳过 + skipped/conflicts 标注（不抛 409——决策 9 修订）；plot_edge 不参与；软删过滤
- 依赖：S2.1、S5.1
- 验证：vitest 覆盖四 op、冲突跳过、双层排序、软删过滤
- 回滚：单 commit

**S5.3 Delta 路由**
- 范围：POST 追加、GET /node/:nodeId、POST /compute（含 conflicts 返回；OUTLINE_NODE_NOT_FOUND）
- 依赖：S5.2
- 验证：集成测试含冲突场景
- 回滚：单 commit

**S5.4 Delta 展示**
- 范围：大纲节点/实体详情内 Delta 列表与变更摘要、compute 状态预览（含 conflicts 标注）
- 依赖：S3.6、S5.3
- 验证：手工走查冲突场景
- 回滚：单 commit

### 切片 6：模型与工具层（验收：工具目录全部注册、权限分级正确、测试全绿）

**S6.1 LLM 客户端**
- 范围：`client.ts`（fetch → DeepSeek、流式 SSE 解析、模型名可配置、key 注入源）、`types.ts`
- 依赖：T1.4
- 验证：mock fetch 单测（流式分片、错误响应）；无 key 可全测
- 回滚：单 commit

**S6.2 重试与 token**
- 范围：`retry.ts`（429/5xx/超时退避重试）、`token.ts`（估算）、工具结果 token 截断（决策 15）
- 依赖：S6.1
- 验证：vitest mock 断言重试次数与退避；估算边界
- 回滚：单 commit

**S6.3 查询类工具**
- 范围：registry + get_entity / search_entities / query_relationships / get_outline / get_outline_path / compute_state / get_delta_history / get_entity_summary（自动权限、过滤软删）
- 依赖：S3.2、S5.2、S2.1
- 验证：vitest fixture 库逐一断言返回结构
- 回滚：单 commit

**S6.4 分析类工具**
- 范围：analyze_consistency / detect_conflicts / trace_plot_paths / find_orphan_elements（含 inconsistent_soft_deletes）/ suggest_connections
- 依赖：S6.3
- 验证：vitest 构造已知矛盾/孤立 fixture 断言检出
- 回滚：单 commit

**S6.5 伏笔工具与健康指标**
- 范围：analyze_hook_health / trace_hook_lifecycle / suggest_hook_payoff / find_hook_opportunities / detect_hook_conflicts；`_health` 运行时计算（age/dormancy/stale/overdue/ready_to_resolve/blocked——决策 21 口径：current_position 章节序、half_life 缺省映射、expected_resolve_node_id 未设置不猜测），绝不写回 data
- 依赖：S2.1、S6.3
- 验证：vitest 构造伏笔生命周期 fixture 断言全部指标；断言 data 未写回
- 回滚：单 commit

**S6.6 提案类工具**
- 范围：propose_create/update/delete_entity、propose_add/remove_relation、propose_add_delta、propose_outline/move/delete_node、propose_create/update/advance/resolve/abandon_hook——仅产出提案对象（含 project_id），tool_result 不含预览细节
- 依赖：S6.3
- 验证：vitest 断言提案结构、不落盘、无预览
- 回滚：单 commit

**S6.7 执行类工具 + executor**
- 范围：create/update/delete_entity、add/remove_relation、add_delta、create/move/delete_outline_node、advance_hook/resolve_hook/abandon_hook 复合写（delta+relation 一次提交、幂等按 (node_id, hook_id, relation_type) 判重）
- 依赖：S3.1-S4.1、S6.6
- 验证：vitest 断言复合写原子性与幂等
- 回滚：单 commit

### 切片 7：对话服务（验收：SSE 流、心跳断连、提案确认全链路服务端就绪）

**S7.1 会话管理**
- 范围：`session.ts` 历史维护、滑动窗口成对裁剪（tool_call/tool_result 同裁同留）、历史重建喂回格式（决策 18）
- 依赖：T2.3
- 验证：vitest mock 消息序列断言成对裁剪与孤儿丢弃
- 回滚：单 commit

**S7.2 上下文组装**
- 范围：`context.ts` 三层提示词注入（决策 7）+ 聚焦上下文（focus_entity/node）+ 工具列表注入 + token 预算
- 依赖：S7.1
- 验证：vitest 断言上下文结构与预算截断
- 回滚：单 commit

**S7.3 主循环**
- 范围：`run.ts` runAgent()——8 轮/120s/token 三重保险（决策 15）、工具失败结构化喂回自纠、模型失败重试、SSE 事件序列（tool_call/tool_result/proposal/text/done/error，proposal 在 tool_result 后、循环继续前）
- 依赖：S6.7、S7.2
- 验证：vitest mock LLM 固定响应断言终止条件与事件顺序
- 回滚：单 commit

**S7.4 工具调度 + 提案内存仓**
- 范围：`executor.ts` 收到 LLM tool_call → 调度 query/analysis/proposal；提案仓（TTL 10 分钟 + 条数上限 + project_id 绑定，切换项目清空——决策 14 修订）
- 依赖：S6.6、S7.3
- 验证：vitest 假时钟断言 TTL 过期与上限淘汰；调度错误路径
- 回滚：单 commit

**S7.5 提案路由**
- 范围：confirm/reject——快照重校验（存在性 + updated_at，大纲节点用节点级 updated_at）、409 PROPOSAL_STALE / 404 PROPOSAL_NOT_FOUND / 409 PROPOSAL_PROJECT_MISMATCH
- 依赖：S7.4
- 验证：集成测试含快照过期场景
- 回滚：单 commit

**S7.6 chat SSE 路由**
- 范围：POST /chat（SSE 流：ping 15-30s 心跳 + 六类事件）、三路断开检测（onAbort + req close/error + 心跳写失败）、全链路取消（AbortController 终止 agent + DeepSeek fetch）、会话列表/历史端点
- 依赖：S7.5
- 验证：集成测试读取 SSE 流断言事件序列；模拟断开断言取消；心跳间隔断言
- 回滚：单 commit

### 切片 8：聊天界面（验收：能对话、能看流式回复、能处理断连）

**S8.1 聊天页（文本流）**
- 范围：消息流渲染、SSE 流式文本、会话列表/恢复（sessions/messages）、流中断提示「上次会话已取消」
- 依赖：T7.2、S7.6
- 验证：stub SSE 事件序列走查；有 key 则真实对话冒烟
- 回滚：单 commit

**S8.2 提案卡片**
- 范围：proposal 事件渲染卡片（含预览）、确认/拒绝调用、PROPOSAL_STALE 失效提示与重新生成引导、确认后结果反馈
- 依赖：S8.1、S7.5
- 验证：stub 走查三种错误码呈现
- 回滚：单 commit

### 切片 9：伏笔面板（验收：伏笔池全生命周期 + 健康指标呈现）

**S9.1 伏笔面板**
- 范围：伏笔池列表（活跃/已回收分组）、健康指标徽标（_health 附加字段）、创建/推进/回收/废弃操作入口（走提案流程）、依赖链展示
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
- 范围：大纲节点画布投影、拖拽定位（坐标/缩放存 localStorage，按 project_id 隔离）、plot_edge 连线创建/删除（连线标签）
- 依赖：S2.3、S3.4
- 验证：手工走查（刷新后布局保持）
- 回滚：单 commit

---

## 阶段 C：收尾

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
