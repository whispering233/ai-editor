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

- **完成**：阶段 A 地基 + 切片 1-9、12、13 + 阶段 U（U1-U8）+ 交互修复批次 + 切片 10 画布（S10.1）+ 切片 11 发布（S11.1-S11.3）+ 发布阻断项 E1-E5（导出/导入、未来版本拒绝重建、增量迁移）——详见「项目演进路线」。
- **待做**：E6 发布收尾（npmjs Trusted Publisher ×6 配置、CI 全链路重测、坏版本标注、GitHub tag 更新——细分见文末 E6 卡）；backlog 事项一律不做。
- **测试**：全仓 1286 个（shared 88 / db 198 / server 239 / client 383 / tools 225 / llm 59 / agent 94）。
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
- [x] S10.1 画布页
- [x] S11.1 生产构建全链路
- [x] S11.2 端到端冒烟
- [x] S11.3 发布前复审（评审纪要：`doc/design/release-review.md`）
- [x] E1 导出/导入契约 + export 路由
- [x] E2 import 路由（校验 + 原子搬入）
- [x] E3 导出/导入 client UI
- [x] E4 未来版本拒绝重建（堵降级数据丢失）
- [x] E5 增量迁移脚本机制
- [ ] E6 publishConfig + 版本管理 + publish 演练（细分状态见文末 E6 卡——基础已落地，收尾未完成）

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

**切片 10 画布（S10.1，2026-08）**——大纲节点画布投影：自动布局（确定性树序排布）/ 节点拖拽（坐标防抖写 localStorage，key `ai-editor:canvas:{project_id}` 按项目隔离，决策 10）/ 缩放（0.5-2 滚轮 + 按钮）/ 仅场景显示模式；plot_edge 连线创建（拖出→目标→标签表单，RELATION_EXISTS→toast「这条连线已经存在」）/ 删除（点击高亮 + confirm 物理删提示）；伏笔标记复用 S9.2 buildNodeHookMarks 语义；ConfirmDialog 全局桥接上提（FeedbackHost）；`lib/canvas.ts` 15 个纯函数（40+ 测试）。

**切片 11 发布（S11.1-S11.3，2026-08）**——生产构建全链路（`pnpm -r build` → dist 启动，真实目录 14 项走查：SPA fallback / 待命语义 / 端口 +1 / 127.0.0.1 开浏览器）；端到端冒烟（`smoke.test.ts` 9 步链路 123+ 断言：建项目→大纲→实体→关系→Delta→回收站→伏笔→对话→提案确认，真实 HTTP + tmp 项目 + mock LLM）；发布前复审（`doc/design/release-review.md`：阻断项 = #2 导出/导入 + #8 publishConfig 与 publish 演练 + #12 未来版本拒绝重建）。

**调试基础设施（2026-08 独立交付）**——创作根 `.ai-editor/config.json` 纯配置文件调试日志（五类别 chat/request/stream/usage/http 细粒度门控，无 env 开关）；`[llm] request` 完整 prompt / `[llm] stream` 原始 SSE chunk / `[llm] usage` 真实 token 观察。

---

## 发布前阻断项（E1-E6，依据 `doc/design/release-review.md`）

> 发布就绪度评审（S11.3）产出：阻断项 4 项（#2 导出/导入、#8 publishConfig、#8 publish 演练、#12 未来版本拒绝重建），迁移机制按用户裁决在发布窗口内做。zip 库选型 **fflate**（用户裁决）。按卡执行、一卡一 commit、每卡「实现 fixer/designer + 验证 oracle」双代理。

**E1 导出/导入契约 + export 路由**
- 范围：shared 契约（export/import 请求/响应 schema）+ 引入 fflate + `GET /api/v1/project/export`（zip 打包 project.json + outline.json + data.db；导出前 wal_checkpoint(TRUNCATE) 保证完整快照；决策 17 key 不入包）
- 依赖：S11.2（冒烟测试 tmp 项目模式可复用）
- 验证：导出 zip 解包三文件齐全 + 与源文件一致；单测 roundtrip
- 回滚：单 commit

**E2 import 路由（校验 + 原子搬入）**
- 范围：`POST /api/v1/project/import`——解压到临时目录校验（三文件齐全 + project.json/outline.json 顶层契约 + data.db user_version 匹配），全绿原子搬入**新书目录**（books/ 新建，不覆盖现有项目，`PROJECT_ALREADY_EXISTS` 同语义）；user_version 不匹配拒绝导入提示版本不兼容（不静默重建）
- 依赖：E1
- 验证：roundtrip（E1 导出 → E2 导入新书 → 数据完整）；坏包/缺文件/版本不匹配/路径冲突分支
- 回滚：单 commit

**E3 导出/导入 client UI**
- 范围：书架/设置页「导出（下载 zip）/ 导入（选文件）」入口 + 进度/结果 toast；错误码文案映射
- 依赖：E2
- 验证：手工走查 + 组件测试
- 回滚：单 commit

**E4 未来版本拒绝重建（堵降级数据丢失）**
- 范围：migration.ts 的 `user_version > SCHEMA_VERSION` 分支由「重建」改为「拒绝打开 + 明确错误提示升级程序版本」（新错误码/响应字段，前端提示）
- 依赖：无
- 验证：单测覆盖未来版本拒绝 + 旧版本仍重建 + 同版本正常
- 回滚：单 commit

**E5 增量迁移脚本机制**
- 范围：`migrations/` 目录按序执行（001_xxx.sql/ts）+ 每步 `setUserVersion(v+1)` + 启动按 user_version < SCHEMA_VERSION 前向执行 + 迁移前自动快照（复用备份函数，命名加时间戳）；决策 13 增补「删库重建策略于 v0.1.0 发布终止」
- **import 侧版本兼容（ora-4 决议）**：E5 迁移机制放开 open 侧旧版本后，import 需同步决定是否接受旧版本备份（当前一律 409 SCHEMA_VERSION_MISMATCH，文案已按相对版本分流「备份来自旧版本程序」——放开时改为导入前执行迁移，或维持拒绝）
- 依赖：E4
- 验证：空迁移/多步顺序/失败回滚/快照生成；文档更新（schema.md/decisions.md）
- 回滚：单 commit

**E6 publishConfig + 版本管理 + publish 演练**
- 范围：6 包 `publishConfig: { access: "public" }` + 版本同步规则（`scripts/sync-version.mjs` 批量同步 6 发布包 + client + 根）+ `scripts/publish-packages.mjs`（依赖序发布：判重幂等/tarball workspace: 防线/tag 一致性校验）+ `scripts/verify-installed.mjs`（安装态冒烟）+ `CHANGELOG.md`（Keep a Changelog 手动维护）+ `release.yml`（release-from-changelog 出 GitHub Release）+ `publish.yml`（tag 触发 OIDC 发布 6 包）+ AGENTS.md 发布流程段 + 真实 npm publish 演练（依赖序 shared → llm/db/tools → agent → server → registry 安装 `npm i -g @whispering233/ai-editor-server` 启动验证）
- 依赖：E1-E5（发布内容完整）
- 验证：dry-run 包内容清单 + 演练记录
- 回滚：单 commit

**E6 当前状态（2026-08-04）**——基础全部落地，发布收尾未完成：

已完成：
- ✅ publishConfig ×6、sync-version/publish-packages/verify-installed 脚本、双 workflow、AGENTS.md 发布流程段、README 发布说明
- ✅ 全仓包名改 `@whispering233/ai-editor-*`（`@ai-editor` scope 在 npm 被其他用户占用，发布被拒后改名；178 文件）
- ✅ 6 包已发布 npm（v0.0.1/v0.0.2/v0.0.3——**v0.0.3 是首个可正常安装版本**）；GitHub Release v0.0.1 + CI 全量验证修复（build 先行）
- ✅ 发布管道两轮修复（npm 12 manifest 时序坑）→ 最终方案：发布前主动替换 + `npm publish --ignore-scripts`，manifest 与 tarball 一致（已验证 agent@0.0.3 manifest 正确）

未完成（按序）：
- ⏳ npmjs 网页配置 **Trusted Publisher ×6**（`@whispering233/ai-editor-{shared,llm,db,tools,agent,server}`；Publisher=GitHub Actions、仓库 whispering233/ai-editor、workflow publish.yml；**需先开启 npm 账号 2FA**）——CI OIDC 发布前置
- ⏳ 坏版本 v0.0.1/v0.0.2 deprecate 标注（automation token 不能 unpublish；deprecate 需 2FA 凭据）
- ⏳ `verify-installed` 安装态冒烟最终验证（server@0.0.3 manifest 传播后）
- ⏳ GitHub tag 更新到改名代码并打 `v0.0.3`（当前远端 v0.0.1 tag 指向旧代码 e6d685e）
- ⏳ CI 全链路重测（Trusted Publisher 配好后 push tag 触发：release.yml 建 Release + publish.yml OIDC 发布 + verify-installed 冒烟）

已知问题/坑（记录）：
- npm 12 publish 用 postpack 恢复后的 package.json 生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）；修复见上
- automation token（绕过 2FA）**不能执行 unpublish/deprecate 类写操作**（npm 安全策略 403）——需 2FA 凭据或网页操作
- npm 新包发布后 registry manifest 有 CDN 传播延迟（dist-tags 即时可见、`npm view` 短暂 404，数分钟）
