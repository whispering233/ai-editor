# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、`hooks.md`（伏笔）、`decisions.md`（决策 1-23）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- **推进节奏**：每张卡完成后向用户汇报验证结果，用户确认后开下一张；每切片结束时演示一次端到端功能验收。
- 卡内不做卡外顺手改动；backlog.md 事项一律不做。
- 每个切片结束时功能端到端可用；切片间严格按依赖序，不跳卡。
- 契约以 `doc/api`、`doc/database` 为准，发现文档矛盾先停下提问，不要自行发明。
- 环境：Node 22.23 / pnpm 11.8（满足 Node ≥ 22.12 / pnpm 10+，workspace 需配 `allowBuilds: { better-sqlite3: true }`（pnpm 11+；pnpm 10 旧格式 `onlyBuiltDependencies`））。无 git 远端，CI 任务不做。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。

---

## 项目状态（2026-08）

- **完成**：阶段 A 地基 + 切片 1-9、12、13 + 阶段 U（U1-U8）+ 交互修复批次——详见「项目演进路线」。
- **待做**：切片 10 画布（S10.1）、切片 11 发布（S11.1-S11.3）——卡片规格见文末，直接按卡执行。
- **测试**：全仓 1176 个（shared 84 / db 187 / server 214 / client 316 / tools 225 / llm 59 / agent 94）。
- 已完成卡片的详细规格已归档（git history 可回溯）；「项目演进路线」提供脉络摘要，配合 `decisions.md`（决策 1-23 为设计主轴）理解现状。

## 执行进度（Todo）

- [x] 阶段 A 地基（T0 脚手架 / T1 shared 契约 / T2 数据层 / T6 服务骨架 / T7 客户端骨架）
- [x] 切片 1 项目管理 · 2 大纲 · 3 实体与关系 · 4 回收站 · 5 Delta
- [x] 切片 6 模型与工具层（S6.1-S6.7）
- [x] 切片 7 对话服务（S7.1-S7.6）
- [x] 切片 8 聊天联调（S8.1-S8.2）
- [x] 切片 9 伏笔面板（S9.1-S9.2）
- [x] 切片 12 大纲节点详情（决策 23）· 切片 13 大纲交互重构
- [x] 阶段 U UI 工作台重构（U1-U8）
- [x] 交互修复批次（2026-08：数据刷新信号 / 会话恢复 / ErrorBoundary / Base UI #31）
- [ ] S10.1 画布页
- [ ] S11.1 生产构建全链路
- [ ] S11.2 端到端冒烟
- [ ] S11.3 发布前复审

---

## 项目演进路线（2026-08，已完成工作摘要）

> 供后续理解项目脉络；每项一行 = 目标 + 关键决策（决策编号见 `decisions.md`）。详细契约以 `doc/api`、`doc/database`、`doc/ui` 各文档为准。

**阶段 A：地基**（T0-T7）——pnpm 7 包 monorepo（shared → llm/db/tools → agent → server，client 只依赖 shared）；shared 纯类型/常量/纯函数（zod 仅服务端经 `./schemas` 子路径导出，client 打包安全）；vitest/tsc/eslint 三件套；schema 演进删库重建（决策 13）；存储三文件（outline.json / data.db / project.json）原子写（决策 11）。

**切片 1 项目管理**——create/open/close/config；书架模式（books/ 子目录，决策 8 修订）；启动待命语义（无 project.json 不初始化）；LLM key 用户级配置 `~/.ai-editor/config.json`（决策 17，绝不入项目文件）。

**切片 2 大纲**——严格三层卷→章→场景、无游离节点（决策 19）；节点级 `updated_at` 版本戳；章节序推导（决策 21 口径：全局章序号现推）。

**切片 3 实体与关系**——四类实体（人物/设定/地点/伏笔）CRUD；通用关系表 `relation_records`（决策 2，含 plot_edge 剧情连线）；k 跳遍历；软删级联（决策 12）。

**切片 4 回收站**——软删还原/purge 级联；启动一致性校验兜底（决策 16 修订：以大纲节点软删为准补标 DB 关联记录）。

**切片 5 Delta**——`delta_records` 独立表；computeState 只沿大纲树父链累积已确认 Delta（决策 9：op=update from 校验失败跳过 + conflicts 标注，不抛 409）。

**切片 6 模型与工具层**——LLM 客户端（fetch → DeepSeek 手写 SSE 解析/[DONE] 哨兵/abort 三保险/length 截断防御）；重试分类（配额/计费不可重试、指数退避、abort 永不重试）；token 估算（chars/4 + 真实 usage 基线）；**44 工具注册**（查询 8/分析 5/伏笔 5/提案 14/执行 12）——SQL 一律下沉 db 查询层、提案仅产出对象零落盘（决策 14）、执行类不暴露 LLM；`_health` 健康指标决策 21 口径绝不写回 data。

**切片 7 对话服务**——会话管理（决策 18：tool_call/tool_result 成对裁剪、孤儿整对丢弃、末条 user/tool 约束）；上下文组装（决策 7 三层注入 + 决策 6 分层预算 + usage 基线）；runAgent 三重保险（8 轮/120s 含工具执行/token）六类事件序列；提案仓（TTL 10min/上限/项目绑定）+ 提案路由快照重校验（决策 14/19）；chat SSE 路由（心跳 15-30s/三路断开检测/全链路取消，决策 16/20）。

**切片 8 聊天联调**——S7.6 帧 ↔ client 解析契约核对 0 gap；提案卡接入（confirm/reject 三错误码分支 + 防重复 + 全局 toast）。

**切片 9 伏笔面板**——分组列表（活跃/已回收/已废弃）+ 复合写确认面板（delta+relation+status 同步三请求幂等收敛——ora 裁决保留三步）+ 依赖链递归展开；大纲节点伏笔标记（plants/advances/resolves 徽标）；**MVP 简化：不展示 _health 健康指标与章节序**（backlog #13）。

**切片 12/13（2026-08 用户反馈）**——节点结构化 data（决策 23 麦基《故事》字段集）+ `#/outline/:nodeId` 详情页；大纲交互重构（操作平铺图标化/拖拽上下半排序/摘要独立行/变更记录目标类型仅实体）。

**阶段 U：UI 工作台重构**（U1-U8，决策 22）——三栏 1:5:4 布局（左书架树/中信息条+6 tab/右 ChatPanel 常驻，`<1024px` 抽屉）；shadcn 集成 + oklch 文学氛围双主题（U1）；会话归属项目（chat store 订阅 project store 联动）；全局反馈（toast/错误横幅/确认对话框）。

**交互修复批次（2026-08 用户实测反馈）**——数据变更刷新信号（ui store `dataVersion`：AI 提案确认后中栏 7 页面自动重拉 + InfoBar 全局刷新按钮）；刷新页面自动激活最近会话（loadSessions 非空自动激活）；应用级 ErrorBoundary 防白屏（可恢复错误卡）；Base UI error #31 根因修复（DropdownMenuLabel 必须 DropdownMenuGroup 包裹——GroupLabel 裸放 Popup 内取不到 MenuGroupContext）。

**调试基础设施（2026-08 独立交付）**——创作根 `.ai-editor/config.json` 纯配置文件调试日志（五类别 chat/request/stream/usage/http 细粒度门控，无 env 开关）；`[llm] request` 完整 prompt / `[llm] stream` 原始 SSE chunk / `[llm] usage` 真实 token 观察。

---

## 切片 10：画布（待做）

**S10.1 画布页**
- 范围：大纲节点画布投影、拖拽定位（坐标/缩放存 localStorage，按 project_id 隔离）、plot_edge 连线创建/删除（连线标签）；**接入三栏布局**——中栏 tab「画布」（`#/canvas`，layout.md §1，2026-08 修订）；伏笔标记集成（S9.2 语义，画布节点标记）
- 依赖：S2.3、S3.4
- 验证：手工走查（刷新后布局保持）
- 回滚：单 commit

## 切片 11：发布（待做）

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
