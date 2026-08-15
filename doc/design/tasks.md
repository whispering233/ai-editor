# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、`hooks.md`（伏笔）、`decisions.md`（决策 1-26）。

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

- **完成**：阶段 A 地基 + 切片 1-9、12、13 + 阶段 U（U1-U8）+ 交互修复批次 + 切片 10 画布（S10.1）+ 切片 11 发布（S11.1-S11.3）+ 发布阻断项 E1-E6（导出/导入、未来版本拒绝重建、增量迁移、发布链路 OIDC 全绿）+ 阶段 B 项目提示词编辑（B1，决策 24/25）+ **阶段 C 时间轴（C1-C4，决策 26）** + 画布增强批次（S10.2-S10.5，inkos 参考）+ 交互优化批次（UX1-UX4，用户实测反馈）+ **阶段 B2 自动备份与恢复（B2.1-B2.4，决策 27）** + **B2.5 备份命名增强（毫秒精度 + 自定义名称，决策 28）** + **用户反馈批次 F1-F9（2026-08 实测：Bug 2 项——事件字段清空语义 / 自动备份漏检 data.db-WAL；交互优化 4 项——垂直时间轴 UI / 同标签归组 / 时间标签样式 / 行内完整描述；新需求 3 项——三栏可收起拖宽 / 标签输入建议 / LLM 时间标签排序提案）**——详见「项目演进路线」。
- **待做**：无（MVP 与阶段 A/B/C/B2 全部完成；可选收尾 = npm 坏版本 v0.0.1/v0.0.2 deprecate 标注——需 2FA 凭据，见 E6 卡）；backlog 事项一律不做。
- **测试**：全仓 1561 个（shared 131 / llm 59 / db 224 / server 313 / client 503 / tools 237 / agent 94）。
- 已完成卡片的详细规格已归档（git history 可回溯）；「项目演进路线」提供脉络摘要，配合 `decisions.md`（决策 1-28 为设计主轴）理解现状。

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
- [x] 画布增强批次（S10.2 连线质量 / S10.3 小地图 / S10.4 重布局 / S10.5 hover 路径高亮）
- [x] 交互优化批次（UX1 画布连线拖出即连+线上编辑标签 / UX2 侧栏新建行内化 / UX3 关联轻量弹层 / UX4 实体新建行内化）
- [x] S11.1 生产构建全链路
- [x] S11.2 端到端冒烟
- [x] S11.3 发布前复审（评审纪要：`doc/design/release-review.md`）
- [x] E1 导出/导入契约 + export 路由
- [x] E2 import 路由（校验 + 原子搬入）
- [x] E3 导出/导入 client UI
- [x] E4 未来版本拒绝重建（堵降级数据丢失）
- [x] E5 增量迁移脚本机制
- [x] E6 publishConfig + 版本管理 + publish 演练（OIDC 发布链路全绿——见文末 E6 卡）
- [x] B1 项目提示词编辑器（设置页编辑保存 → 注入「## 项目设定」段）
- [x] 阶段 C 时间轴（C1 契约与数据层 / C2 服务端 / C3 列表页 / C4 详情页）
- [x] 阶段 B2 自动备份与恢复（B2.1 契约与配置 / B2.2 备份管道+定时器+端点 / B2.3 import 分流+rename / B2.4 client 备份区+书架 / B2.5 备份命名增强：毫秒精度 + 自定义名称）
- [x] B2.6 备份类型标签 + 备份重命名（决策 29：kind 文件名标记段 + `POST /backup/rename` + 列表标签/行内重命名 UI）

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

**发布阻断项 E1-E6（2026-08，全部完成）**——导出/导入（E1-E3：fflate zip 导出三文件 + wal_checkpoint 完整快照 / import 校验（zip 白名单防穿越/顶层契约/user_version）+ 原子搬入 books/ 新书 / 书架导入导出 UI）；schema 安全（E4：未来版本拒绝重建 `PROJECT_VERSION_NEWER` 零触碰 / E5：增量迁移机制 `migrations/` 目录按序执行 + 迁移前时间戳快照 + hasMigrationPath + import 侧联动）；发布链路（E6：publishConfig ×6 + 包名改 `@whispering233/ai-editor-*`（`@ai-editor` scope 被占）+ sync-version/publish-packages/verify-installed + release.yml/publish.yml（OIDC Trusted Publishing）+ CHANGELOG.md + **CI 发布全链路全绿（v0.0.4 由 CI 自动发布）**——发布管道坑记录见文末 E6 卡）。

**阶段 B：项目提示词编辑（B1，2026-08）**——创作伴侣定位（决策 24：不编辑/存储/读取正文，AI 基于结构化数据建议）；用户自定义上下文裁决（决策 25）：项目 `prompt` 字段（跟随书籍）是唯一持久化通道，设置页补编辑 UI（B1：按项目身份载入/防写错、PUT patch 保存、空值清除、无项目禁用态）；规则文件机制（rules.md）与提示词重复 → 否决；临时指令层（聊天框即临时指令）→ 否决。

**阶段 C：时间轴（C1-C4，2026-08）**——第 5 种实体类型 `event`（id 前缀 `ev-`，决策 26）：中栏新增「时间轴」tab（伏笔与回收站之间）；entities 表新增 `sort_order` 列（全局事件线性序，拖拽为权威、时间标签仅展示）；SCHEMA_VERSION 1→2，E5 迁移机制首个真实用例（`002_event_timeline.ts` 建新表拷贝改 CHECK）；`occurs_in` 关系类型锚定大纲节点（多对多，倒叙/多时间线/无场景事件均可表达）；列表页 `#/timeline`（拖拽排序 + tags 徽标 + 标签筛选器 + 新建）+ 详情页 `#/timeline/:id`（字段编辑 + occurs_in 关联管理）；**MVP 无 AI 工具**（时间线一致性分析、事件草案生成 → backlog #15）。

**画布增强批次（S10.2-S10.5，inkos 参考，2026-08）**——保持自研不引库（@xyflow/react 留作节点 >500 升级路径）：连线语义色三级优先级（hover 路径 > 目标节点层级 > 默认灰）+ 箭头 marker + 选中/路径流动虚线；小地图（归一化节点矩形 + 视口框，自研零依赖）；「重新布局」按钮（`mergeLayout` 幂等——已存坐标保留、仅新节点补位，inkos `position ?? 自动计算` 模式）；hover 节点沿 plot_edge 向前 DFS 路径高亮（`dfsForwardPath` 纯函数，非路径降透明 0.2）。

**交互优化批次（UX1-UX4，2026-08 用户实测反馈）**——① UX1 画布连线改造：拖出即连（移除标签 Dialog）+ 连线标签线上就地编辑（新增 `PUT /relation/:id` metadata 整体替换契约）+ 拖线期间禁用 hover 高亮（修复连线时其他节点全暗的交互冲突）；② UX2 侧栏新建项目行内化（书架头部行内输入框，失焦取消防误触；`validateBookName` 三处复用）；③ UX3 时间轴关联节点全屏 Dialog → 轻量 Popover 弹层；④ UX4 实体新建 Dialog → 列表首行内联编辑行（提交成功仍跳详情页）；全仓 Dialog 梳理结论：A 组 4 项去对话框化、B 组 7 项保留（多字段/复杂选择器/复合写确认）、C 组 10 个确认框保留。

**阶段 C：时间轴（C1-C4，2026-08）**——第 5 种实体类型 `event`（id 前缀 `ev-`，决策 26）：中栏新增「时间轴」tab（伏笔与回收站之间）；entities 表新增 `sort_order` 列（全局事件线性序，拖拽为权威、时间标签仅展示）；SCHEMA_VERSION 1→2，E5 迁移机制首个真实用例（`002_event_timeline.ts` 建新表拷贝改 CHECK）；`occurs_in` 关系类型锚定大纲节点（多对多，倒叙/多时间线/无场景事件均可表达）；列表页 `#/timeline`（拖拽排序 + tags 徽标 + 标签筛选器 + 新建）+ 详情页 `#/timeline/:id`（字段编辑 + occurs_in 关联管理）；**MVP 无 AI 工具**（时间线一致性分析、事件草案生成 → backlog #15）。

**阶段 B2：自动备份与恢复（B2.1-B2.4，2026-08 用户裁决，决策 27）**——备份/频率/列表均项目级（跟随书籍）：自动备份定时器（有变更才备份：三文件 mtime 判定 + 1s 容差防 checkpoint 自激，`.backups/` 时间戳命名保留 20 份）；频率 = project.json `backup_frequency_minutes`（缺省 10，枚举 5/10/15/30/60，读侧宽松/写侧显式）；**唯一 key = project_id**——导入/加载 zip 内 id 匹配书架 → 覆盖恢复（保留当前 id 防会话断连 + 覆盖前自动快照后悔药 + 跨项目恢复迁移 chat_messages 归属）/ 不匹配 → 导入新书（同名不再 409：重命名导入或目录去重 `书名 (N)`，维持「目录名=书名」不变式）；书架重命名书名（原子移动目录 + 引用同步）；打包/校验/恢复管道统一提取（`server/src/backup.ts`，E1 export/import 重构复用）；restore 与 import 走同款 E4/E5 三态校验（坏包/高版本零触碰）。

**B2.5 备份命名增强（2026-08 用户反馈，决策 28）**——手动备份支持自定义名称（`POST /project/backup` 可选 `name`：trim 后 1-30 字符、禁路径分隔符/保留字符/控制字符/纯点、自动剥 `.zip`；校验收敛 shared `sanitizeBackupName`，`writeBackup` 为唯一执行点）+ **文件名毫秒精度**（`<YYYYMMDD-HHmmssSSS>.zip`，旧秒级格式兼容解析不迁移）；`GET /backups` 响应项新增可选 `name`（文件名解析，旧备份无）；设置页「立即备份」旁名称输入框 + 列表名称展示 + 时间显示补秒（`MM-DD HH:mm:ss`）；保留策略/变更判定/restore 白名单按新 parse 兼容三类文件名。

**B2.6 备份类型标签 + 备份重命名（2026-08 用户反馈，决策 29）**——界面简单标签区分手动/自动备份 + 备份列表支持重命名（行格式「时间 + 简单标签 + 用户自定义命名」）：**类型标签持久化 = 文件名编码**（无状态，决策 27 哲学）——格式扩展 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`，kind 段 `m`（手动，**无名称也带 `-m` 段**）/ `a`（自动备份重命名后带名称）；自动/快照保持纯时间戳；旧格式兼容解析（旧秒级 → auto、旧带名称无 kind 段 → manual）；**kind 不随重命名改变**；`GET /backups` 响应项新增必填 `kind`；新增 `POST /project/backup/rename` `{ fileName, name? }`（sanitize 同决策 28，name 空 = 清除名称段，幂等，同目录 rename 原子）；设置页列表行标签 + 行内重命名编辑 + 恢复 Dialog 展示标签。

---

## 发布前阻断项（E1-E6，依据 `doc/design/release-review.md`）

> ✅ **E1-E6 已全部完成（2026-08-04）**：导出/导入（E1-E3）、未来版本拒绝重建（E4）、增量迁移机制（E5）、发布链路（E6，CI OIDC 全绿）——详细规格已归档（git history 可回溯），完成摘要见「项目演进路线」；发布管道坑记录保留于 E6 卡下方。

**E6 publishConfig + 版本管理 + publish 演练**
- 范围：6 包 `publishConfig: { access: "public" }` + 版本同步规则（`scripts/sync-version.mjs` 批量同步 6 发布包 + client + 根）+ `scripts/publish-packages.mjs`（依赖序发布：判重幂等/tarball workspace: 防线/tag 一致性校验）+ `scripts/verify-installed.mjs`（安装态冒烟）+ `CHANGELOG.md`（Keep a Changelog 手动维护）+ `release.yml`（release-from-changelog 出 GitHub Release）+ `publish.yml`（tag 触发 OIDC 发布 6 包）+ AGENTS.md 发布流程段 + 真实 npm publish 演练（依赖序 shared → llm/db/tools → agent → server → registry 安装 `npm i -g @whispering233/ai-editor-server` 启动验证）
- 依赖：E1-E5（发布内容完整）
- 验证：dry-run 包内容清单 + 演练记录
- 回滚：单 commit

**E6 当前状态（2026-08-04）**——✅ **全部完成**：

- ✅ publishConfig ×6、sync-version/publish-packages/verify-installed 脚本、双 workflow、AGENTS.md 发布流程段、README 发布说明
- ✅ 全仓包名改 `@whispering233/ai-editor-*`（`@ai-editor` scope 被占）；6 包已发布 npm（v0.0.1/v0.0.2/v0.0.3/v0.0.4——**v0.0.4 由 CI OIDC 自动发布，全链路验证通过**）
- ✅ npmjs Trusted Publisher ×6 配置完成（需 npm 账号 2FA 前置）
- ✅ CI 全链路全绿（Release + Publish：全量验证 → OIDC 发布 → 安装态冒烟）
- ✅ 发布管道四轮修复：npm 12 manifest 时序（主动替换 + `--ignore-scripts`）、CI npm 10.9.8 不支持 OIDC（升级 `npm@latest`）、provenance 校验（补 `repository` 字段）+ verify-installed 缓存传播重试（**v0.0.7 再修：先 `npm view` 轮询 6 包可见 20×30s 再 install**——v0.0.6 实录传播超 5 分钟仍超窗）
- ⏳ 可选收尾：坏版本 v0.0.1/v0.0.2 deprecate 标注（automation token 不能执行，需 2FA 凭据或 npmjs 网页——见 AGENTS.md 发布流程段）

已踩坑记录（完整）：
- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证**（Trusted Publishing）→ 发布无换证，npmjs 404 保护性拒绝 → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 与 provenance 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN`，npm 检测到它优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- 新发布版本 registry 文档缓存有数分钟传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ 演进：verify-installed install 重试（5×15s）→ 窗口扩至 10×30s（v0.0.5）→ **v0.0.6 实录传播超 5 分钟仍超窗（发布成功仅验证超窗，重跑通过）→ v0.0.7 改为先 `npm view` 轮询 6 包全部可见（20×30s = 10 分钟窗口）再 install**——传播期内轻量轮询、传播完成即装，超时未可见直接判失败（版本未发布/网络），不再盲重试完整 install
- automation token（绕过 2FA）不能执行 unpublish/deprecate（npm 安全策略 403）→ 需 2FA 凭据或网页操作

---

## 阶段 B：项目提示词编辑（决策 25，2026-08）

> **背景**：创作伴侣定位（决策 24）确定后，「用户如何把自身规则、行业要求与经验注入 AI 上下文」成为核心体验问题。现状（2026-08 实测）：项目 `prompt` 字段（跟随书籍，project.json）是唯一持久化通道，注入 system「## 项目设定」段，但**无编辑 UI**（Dashboard 仅只读展示）。
> **范围裁决（2026-08 用户）**：只做项目提示词编辑 UI；规则文件机制（rules.md）与提示词功能重复 → 否决；临时指令层（聊天框本身即临时指令）→ 否决（裁决依据见决策 25）。
> **✅ B1 已完成（2026-08，commit `66785bc`）**：设置页「项目提示词」区——按项目身份载入/填充（防切项目写错）、`PUT /project/config` patch 保存、toast + dataVersion 刷新、空值清除、无项目禁用态；验证：tsc/lint/383 测试全绿 + oracle 审查通过 + 用户手工验收确认。

**B1 项目提示词编辑器（client）**
- 范围：Settings.tsx 新增「项目提示词」多行文本域 + [保存提示词]（`PUT /api/v1/project/config` patch `prompt`）→ toast + `dataVersion` +1；空值保存 = 清除（后续请求「## 项目设定」整段跳过）；注入机制已存在（agent `buildSystemBase`「## 项目设定」段），不改动
- 依赖：无（PUT config API 已就绪）
- 验证：手工（编辑保存 → 新对话「## 项目设定」含新内容；清空 → 段消失）——✅ 已完成
- 回滚：单 commit（`66785bc`）

---

## 阶段 C：时间轴（决策 26，2026-08）

> **背景**：大纲树表达结构序（卷→章→场景）、关系图表达关联，但都无法表达「事件发生顺序」（倒叙、多时间线）。经外部调研（Aeon Timeline 灵活排序 / Plottr 标签筛选 / oh-story 事件锚点模式）与用户裁决（决策 26）：新增第 5 种实体类型 `event`，中栏新增「时间轴」tab。
> **状态（2026-08）**：✅ C1-C4 已完成（决策 26 落地：event 实体 + `sort_order` 拖拽排序 + `occurs_in` 锚定 + **MVP 无 AI 工具**；全仓 1387 测试全绿，提交见 git log）。
> **范围裁决（2026-08 用户）**：拖拽排序为权威（时间标签仅展示不解析）；锚定 = `occurs_in` 关系（无独立 chapter_anchor 字段）；事件不承载正文（决策 24 边界）、不产生 Delta；AI 工具（时间线一致性分析、事件草案生成）→ backlog #15。

**C1 shared 契约 + db 数据层**
- 范围：`ENTITY_TYPES` 新增 `event`、`RELATION_TYPES` 新增 `occurs_in`、`ENTITY_ID_PREFIX` 新增 `ev-`；event data schema（`description` / `time_label` / `tags`，决策 23 风格）；api.ts 契约（`entityMoveReqSchema` 等）；db `schema.ts` v2（CHECK 更新 + entities 表新增 `sort_order` 列）；`migrations/002_event_timeline.ts`（SQLite 改 CHECK 需建新表拷贝迁移）；查询层（事件列表按 `sort_order`、move 更新顺序、occurs_in 端点软删可见性联动）
- 依赖：无（E5 迁移机制已就绪，本卡为首个真实用例）
- 验证：db 测试（迁移 v1→v2 数据保全、move 顺序、级联软删）
- 回滚：单 commit

**C2 server 端点**
- 范围：泛型实体路由自动获得 event 支持（`parseTypeParam` 校验 event data）；新增 `PUT /api/v1/entity/event/:id/move`（body `{order}`）移动端点；迁移接线验证（旧库打开自动迁移，决策 13 E5 口径）
- 依赖：C1
- 验证：server 测试（CRUD / move / 回收站 / 级联软删）
- 回滚：单 commit

**C3 client 列表页**
- 范围：中栏 tab 注册（TabBar / `KNOWN_ROUTE_SEGMENTS` / renderPage，位置 = 伏笔与回收站之间）；`#/timeline` 列表页（行 / tags 徽标 / time_label / occurs_in 关联数）；拖拽排序（复用 S13 大纲拖拽模式，调 move 端点）；标签筛选器；新建对话框；软删入口
- 依赖：C2
- 验证：tsc / lint / client 测试 + 手工演示
- 回滚：单 commit

**C4 client 详情页**
- 范围：`#/timeline/:id` 字段编辑（name / description / time_label / tags）；occurs_in 关联节点管理（大纲节点选择器 / 关联列表跳转）
- 依赖：C3
- 验证：tsc / lint + 手工演示
- 回滚：单 commit

---

## 画布增强批次（S10.2-S10.5，inkos 参考，2026-08）

> **背景**：画布 S10.1（确定性树布局 + localStorage 坐标 + plot_edge 连线）已上线；经外部调研（`doc/design/backlog.md` 参考源：github.com/Narcooo/inkos 的 `FlowView.tsx`/`story-flow-layout.ts`——技术栈与本项目同源：React 19 + Zustand + Tailwind + Base UI），补 4 项画布能力（用户裁决 2026-08 全部选定）：连线绘制质量、小地图、重新布局能力、hover 路径高亮。**保持自研不引库**（@xyflow/react 留作节点 >500/框选编辑时的升级路径）。详细规格见 `doc/ui/pages/canvas.md`。
> **状态（2026-08）**：✅ S10.2-S10.5 已完成（client 437 测试全绿，提交见 git log）。

**S10.2 连线绘制质量**
- 范围：贝塞尔曲线 + 箭头（marker-end）；语义色（目标节点层级色：场景琥珀/章蓝/卷青，三级优先级 hover 路径 > 目标层级 > 默认灰）；选中/路径边 strokeWidth 1.5→2.5 + 流动虚线动画；非路径边 opacity 0.2；色值集中 `lib/canvas.ts` 常量
- 依赖：无（画布 S10.1 已有 `edgePath`/`edgeMidpoint` 纯函数）
- 验证：canvas 纯函数测试（语义色映射/路径样式派生）+ 手工视觉验收
- 回滚：单 commit

**S10.3 小地图**
- 范围：画布右下角缩略图——节点外框矩形（类型色填充）+ 视口框；`lib/canvas.ts` 纯函数计算归一化矩形（输入 nodes/positions/zoom/视口 → 输出矩形列表），组件只渲染；点击跳转视口（MVP 先只读展示）
- 依赖：S10.1（坐标/缩放已有）
- 验证：canvas 纯函数测试（归一化/边界）+ 手工验收
- 回滚：单 commit

**S10.4 重新布局能力（inkos `position ?? 自动计算` 模式）**
- 范围：`mergeLayout` 语义升级——已有坐标保留（含拖拽结果），仅新节点用自动布局初值；[自动布局] 按钮改「一键重排」：保留已拖拽坐标，仅新节点补位 + 孤儿节点兜底；结构变化（增删节点）自动走同一路径
- 依赖：S10.1（mergeLayout 已有）
- 验证：canvas 纯函数测试（已存坐标不动的幂等重排/新节点补位/孤儿兜底）
- 回滚：单 commit

**S10.5 hover 路径高亮（inkos `dfsForwardPath` 模式）**
- 范围：hover 节点 → 沿 plot_edge 出边向前 DFS（visited 防环）得 {nodeIds, edgeIds}；路径节点/边高亮（紫圈/紫线 + 动画），非路径节点与边 opacity 0.2；mouseLeave 恢复；纯函数可测；hover 为本地 UI 态不写回数据层（决策 10 投影语义）
- 依赖：S10.2（语义色/路径样式派生复用）
- 验证：canvas 纯函数测试（DFS 方向/防环/双集合）+ 手工验收
- 回滚：单 commit

---

## 交互优化批次（UX1-UX4，2026-08 用户实测反馈）

> **背景**：画布增强批次上线后用户实测反馈：① 连线创建时（拖线期间）其他节点全部降透明——S10.5 hover 高亮与连线创建交互冲突，看不清连线目标；② 连线创建弹 Dialog 打断拖放流——连线是直接逻辑，应「拖出即连、线上就地编辑标签」；③ 全仓 Dialog 表单提交梳理（15 文件逐核，exp-3）——单字段/短文本的对话框可改行内编辑，多字段/复杂选择器/复合写确认保留。用户裁决 2026-08：画布交互修复+连线改造（I1）、侧栏新建项目行内化（I2）、时间轴关联节点轻量弹层（I3）、实体新建行内化（I4）全部选定。详细规格见 `doc/ui/pages/canvas.md`（连线交互改造）与 `doc/api/endpoints.md`（PUT /relation/:id）。
> **状态（2026-08）**：✅ UX1-UX4 已完成（client 444 测试全绿，提交见 git log）。

**UX1 画布连线交互改造（拖出即连 + 线上编辑标签 + hover 冲突修复）**
- 范围：
  - **hover 冲突修复**：连线创建中（`createFrom !== null`）禁用 hover 路径高亮（拖线时清 hover 态 / hoverPath 派生条件加 createFrom 判断）——拖线时其他节点不再降透明
  - **拖出即连**：松手命中目标即 `POST /relation`（无标签直接创建），移除新建连线 Dialog（Canvas.tsx createDialog 状态/表单删除）；RELATION_EXISTS/VALIDATION_ERROR 终态 toast 保留
  - **线上编辑标签**：点击选中连线 → 线中点标签处内联输入框（无标签显示占位「+ 标签」）→ Enter/失焦 → `PUT /relation/:id`（`metadata: { label }` 整体替换）→ 重拉；空标签提交 = 清除（`metadata: {}`）
  - **后端**：新增 `PUT /api/v1/relation/:id`（shared `relationUpdateMetaReqSchema` + db updateRelationMetadata + server 路由 + 测试；metadata 整体替换、label trim、软删关系 404）
- 依赖：无（S10.2 已提供标签渲染/选中态基础）
- 验证：server 测试（PUT metadata/404/trim/整体替换）+ client lib/api 测试（updateRelationMeta 封装）+ 手工走查（拖出即连/线上编辑/双提交防护）
- 回滚：单 commit

**UX2 侧栏新建项目行内化**
- 范围：Sidebar「＋」新建项目 Dialog → 书架头部**行内展开输入框**（书名单字段，回车/失焦提交 `createProjectAt`；Esc/失焦取消——失焦取消需确认不误触，或失焦提交+成功关闭）；与 Dashboard 引导页表单共用 createProjectAt 逻辑
- 依赖：无
- 验证：client 测试（book-name 校验纯函数，已落实）+ 手工验收（行内输入/提交/取消/路径安全校验提示保留）
- 回滚：单 commit

**UX3 时间轴详情关联节点轻量弹层**
- 范围：TimelineDetail「+ 关联场景/章节」全屏模态 Dialog → **轻量 Popover 弹层**（Base UI Popover 内嵌大纲树形下拉，单字段选择器非模态）；409 RELATION_EXISTS 内联提示保留
- 依赖：无
- 验证：client 纯函数测试（如有）+ 手工验收（Popover 内嵌大纲树形选择、409 RELATION_EXISTS 内联提示）
- 回滚：单 commit

**UX4 实体新建行内化**
- 范围：EntityList「+ 新建」Dialog → **列表首行内联编辑行**（name + 该类型首字段；hook 类型 status 下拉保留；提交成功跳详情页语义保留——行内提交后 `navigate("/entities/:type/:id")`）
- 依赖：无
- 验证：client 纯函数测试（如有）+ 手工验收（行内编辑/提交/取消/跳详情语义）
- 回滚：单 commit

---

## 阶段 B2：自动备份与恢复（B2.1-B2.4，2026-08 用户裁决，决策 27）

> **背景**：E1 手动导出/导入已具备，但备份依赖手动操作、无历史版本管理。用户需求：自动备份 + 加载备份（文件导入 / 历史自动备份列表二选一）+ 设置备份频率。设计裁决（决策 27）：唯一 key = project_id（匹配 → 覆盖恢复 / 不匹配 → 导入新书）；同名不同 id 不再 409（重命名导入 / 同名并存目录去重二选一）+ 新增重命名书名能力；频率跟随书籍（project.json `backup_frequency_minutes`，缺省 10，选项 关闭/5/10/15/30/60）；定时检查 + 有变更才备份；`.backups/` 时间戳命名、保留 20 份；覆盖前自动快照。契约见 `doc/api/endpoints.md`（备份管理节 + import 改造）、`doc/database/schema.md`（project.json 契约）、`doc/ui/pages/settings.md`（备份区细案）、`doc/ui/layout.md` §2.3（书架重命名/导入冲突）。
> **状态（2026-08）**：✅ B2.1-B2.4 已完成（决策 27 落地；oracle 审核通过）。提交：B2.1 契约 `0f1cc92` / B2.2 备份管道 `cf51cfe`（审核 P1 修复 `6823c4b`）/ B2.3 分流改造 `16a312d`（契约同步 `a5e9836`）/ B2.4 client `0ce5f4d`（审核 P2 修复 `49d44d5`）；**B2.5 备份命名增强（决策 28）已并入本阶段**；全仓测试 green（shared 120 / llm 59 / db 219 / server 292 / client 463 / tools 225 / agent 94）。

> **各卡详细规格已归档（git history 可回溯）**——B2.1 shared 契约与配置 / B2.2 自动备份管道 + 定时器 + 备份管理端点 / B2.3 import 分流改造 + rename / B2.4 client 设置页备份区 + 书架改造；实现摘要见上方「项目演进路线」B2 段。

---

## B2.5 备份命名增强：毫秒精度 + 手动备份自定义名称（2026-08 用户反馈，决策 28）

> **背景**：B2 上线后用户反馈两点命名痛点——① 文件名时间精度不足（快速连续备份在列表里几乎无法区分，UI 时间显示只到分钟）；② 手动备份不支持自定义名称（无法表达备份意图）。设计裁决（决策 28）：文件名毫秒精度 `<YYYYMMDD-HHmmssSSS>.zip`（旧秒级格式兼容解析、不迁移）；`POST /project/backup` 可选 `name`（trim 后 1-30 字符，禁路径分隔符/保留字符/控制字符/纯点，自动剥 `.zip`，非法 400）；`GET /backups` 响应项新增可选 `name`（文件名解析）；设置页名称输入框 + 列表名称展示 + 时间显示补秒。契约见 `doc/api/endpoints.md`（备份管理节）、`doc/database/schema.md`（自动备份目录）、`doc/ui/pages/settings.md`（备份区）。

**范围**：
- shared：`utils/backup.ts` 新格式 format/parse（返回 `{ time, name? }`）+ 旧格式兼容 + `sanitizeBackupName` 纯函数；`constants/backup.ts` 新增 `MAX_BACKUP_NAME_LENGTH = 30`；`types/api.ts` 新增 `projectBackupReqSchema`（可选 name，形状校验）
- server：`backup.ts` writeBackup 支持 `{ name? }`（sanitize 唯一执行点，非法 400）+ uniqueBackupFileName 毫秒精度（+1ms 去重）+ listBackups 返回 name + 注释更新；`routes/project.ts` POST /backup 读 body + zod 校验
- client：`lib/api.ts` BackupEntry.name + createProjectBackup(name?)；`lib/backup.ts` formatBackupTime 补秒；`backup-section.tsx` 名称输入框（maxLength 30，成功后清空）+ 列表名称展示 + 恢复 Dialog 名称展示
- 测试：shared utils 全量重写（新格式/名称/兼容/非法）；server 新增自定义名称/非法名称/旧格式兼容/毫秒去重用例；client formatBackupTime 补秒预期更新
- 文档：decisions.md 决策 28 / endpoints.md / schema.md / settings.md / architecture.md / CHANGELOG

**验证**：`pnpm typecheck && pnpm lint` + 全仓测试 green（shared 122 / server 293 / client 465，全仓 1477）；oracle 审核通过（无 P0/P1，4 项 P2 已修复）。

**状态（2026-08）**：✅ 已完成（决策 28 落地；oracle 审核通过，P2-1 schema 形状校验收敛 / P2-2 .zip 循环剥尽 / P2-3 三处测试缺口补齐 / P2-4 文案修正）。提交：`2d8e5eb`。

---

## B2.6 备份类型标签 + 备份重命名（2026-08 用户反馈，决策 29）

> **背景**：B2.5 后用户反馈两点体验痛点——① 手动备份不填名称时文件名与自动备份同为纯时间戳，列表无法区分类型；② 备份创建后不能改名（忘填名称/意图变化只能删除重建）。需求：界面简单标签区分手动/自动备份；备份列表支持重命名，行显示格式「时间 + 简单标签 + 用户自定义命名」。设计裁决（决策 29）：**类型标签 = 文件名编码**（无状态，否决旁路元数据文件——引入状态文件与脱钩风险）——格式扩展 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`，kind 段 `m`（手动）/ `a`（自动带名称）；自动/快照纯时间戳不变；旧格式兼容解析不迁移；**kind 不随重命名改变**；`GET /backups` 响应项新增必填 `kind: "auto" | "manual"`；新增 `POST /project/backup/rename`（sanitize 同决策 28、name 空 = 清除名称段、幂等、同目录 rename 原子）。契约见 `doc/api/endpoints.md`（备份管理节）、`doc/database/schema.md`（自动备份目录）、`doc/ui/pages/settings.md`（备份区）。

**范围**：
- shared：`utils/backup.ts` 新增 `BackupKind` 类型（constants/backup.ts）+ parse 返回 `{ time, kind, name? }`（新正则识别 `-m`/`-a` 段 + 旧带名称/旧秒级兼容）+ format 支持 `{ kind?, name? }`（auto 无名称不输出标记段）；`types/api.ts` 新增 `projectBackupRenameReqSchema`（fileName + 可选 name，形状校验）
- server：`backup.ts` BackupFileInfo + kind、writeBackup 支持 `{ kind? }`（缺省 auto；POST /backup 传 manual）+ 新增 `renameBackup(project, fileName, name?)`（parse 白名单 + 存在性 404 + sanitize 400 + 同目录 renameSync 原子 + 幂等返回）；`routes/project.ts` POST /backup 传 kind:manual + 新增 POST /backup/rename
- client：`lib/api.ts` BackupEntry.kind + renameProjectBackup(fileName, name?)；`backup-section.tsx` 列表行标签（自动/手动）+ 行内重命名编辑（预填/Enter 提交/Esc 取消/空输入清除名称）+ 恢复 Dialog 展示标签
- 测试：shared parse/format kind 用例（四类新格式 + 三类旧格式兼容 + 歧义注释）；server rename 端点用例（成功/幂等/清名称/404/400）+ listBackups kind + POST /backup 落 `-m` 段；client api rename 请求 + 组件行为（如有）
- 文档：decisions.md 决策 29 / endpoints.md / schema.md / settings.md / architecture.md / README.md（阅读顺序）

**验证**：`pnpm typecheck && pnpm lint` + 全仓测试 green（shared 126 / server 311 / client 468，全仓 1502）；oracle 审核通过（无 P0；P1 三项已修复：renameSync 目标冲突 409 防护 / client 提交失败 blur 竞态兜底 / 文档失焦语义对齐实现；P2 六项全部处理）。

**状态（2026-08）**：✅ 已完成（决策 29 落地；oracle 审核通过——P1-1 `BACKUP_TARGET_EXISTS` 409（rename 前 existsSync 防静默覆盖）/ P1-2 onBlur saving 守卫 + catch 兜底 toast / P1-3 文档统一「Enter/确认提交、Esc/失焦取消」；P2-1 歧义措辞扩为「单字母 a/m 或以 a-/m- 开头」/ P2-2 restore 400 文案统一含 kind / P2-3 BackupKind 收敛 shared 导入 / P2-4 测试错误码换真实码 / P2-5 测试补充（连字符名称、`-m-` 空名回退、纯空白清除、目标冲突）×4 / P2-6 收尾同步）。

---

## 用户反馈批次二（G1-G2，2026-08 用户实测反馈，逐张单点实施）

> **背景**：F1-F9 全部完成后，用户实测时间轴提出两项新反馈：① 时间轴区块应独立滚动（当前整体页面滚动，事件多时滚到底部 header/筛选器不可见）；② 时间刻度点整块拖拽失去单条事件拖拽能力。用户裁决（2026-08）：① 区块独立滚动；② **数据结构重构**——时间标签从事件剥离为独立「时间标签点」实体，事件经 1:n 关系挂载到时间点下，时间点整体可拖、单条事件任意可拖（设计讨论中，见 G2 卡）。

### G1 时间轴区块独立滚动（交互优化，2026-08 用户反馈）

- 范围：`client/src/pages/Timeline.tsx` 页面布局改为 `flex h-full flex-col`——header（标题 + AI 排序 + 新建事件）与标签筛选器**固定不动**，仅时间轴列表区 `flex-1 min-h-0 overflow-y-auto` 独立滚动；MainPanel 内容区高度约束（U 系列重构已含 `min-h-0 flex-1`，**零改动**，同 Canvas.tsx §631 先例）。其他页面（大纲/画布等）保持整体滚动不变。
- 文档：`doc/ui/pages/timeline.md`（滚动结构 G1 小节）
- 依赖：无
- 验证：手工走查（事件多时滚动列表，header/筛选器保持可见）+ client 测试无回归
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit 待填；根容器 `flex h-full min-h-0 flex-col`——固定区（header + 标签筛选器，滚动时恒可见）+ 滚动区（`min-h-0 flex-1 overflow-y-auto` 收纳错误横幅/骨架/空态/列表/无匹配）；Dialog portal 留在滚动区外；oracle 审核通过（P0/P1 无；P2-1 卡片措辞已同步「MainPanel 零改动」/ P2-2 行为说明：滚动容器从 MainPanel 常驻 div 变为页内 div——切 tab 滚动位置重置、消除跨页滚动污染，属独立滚动自然结果）；client 503 用例全绿 + typecheck/lint/build 通过）。

### G2 时间标签点/事件数据模型重构（设计讨论中，2026-08 用户提出）

- 范围：**时间标签从 event.data 剥离为独立实体**（新实体类型，如 `timepoint`）——时间轴上先定义时间标签点，再在时间点下新建/挂载事件；事件与时间点 1:n 关系（如 `occurs_at`）；时间点整体可拖拽（独立序）、单条事件任意可拖拽（不绑定时间标签，保存时额外存时间点↔事件关系）。涉及：schema 迁移（SCHEMA_VERSION 2→3）、实体体系扩展（ENTITY_TYPES/关系类型/id 前缀）、F1/F4 已实现能力的适配（清空语义/分组/展示）、F9 propose_reorder_events 适配、前端拖拽双轨（时间点序 + 事件序）。**待设计讨论达成共识后切卡**（决策 26 修订注记更新）。

> **背景**：产品使用中发现 9 项问题/需求。用户裁决（2026-08）：先分类——**Bug 2 项**（F1 时间标签无法清除、F2 修改时间轴不触发自动备份）、**交互优化 4 项**（F3 垂直时间轴 UI / F4 同时间标签归组 / F5 时间标签字体颜色 / F6 列表显示完整描述）、**新需求 3 项**（F7 三栏可收起/拖拽调宽 / F8 编辑时已存在标签提示 / F9 LLM 识别时间标签排序提案）；按 Bug → 交互优化 → 新需求顺序**逐张单点实施**（不合并），每张走「文档 → 任务卡 → 实现 → 验证 → 清理」。时间轴 UI（F3）形态裁决：**垂直轴线 + 时间点分组**（组标题 = time_label，组内堆叠；组间按拖拽 sort_order 序）；F3 前先调研 GitHub/流行组件是否可直接引入（lib-1）。

### F1 事件字段无法清除（Bug，2026-08 用户反馈）

- 范围：`client/src/lib/timeline.ts` `buildEventDetailPatch` 清空语义修复——原实现「空值不提交」导致 `description`/`time_label`/`tags` 一经填写无法清除；改为「原值非空时提交空值显式清除」（`""` / `[]`），原值本就为空 → 无变更不提交（`null` 语义保持）。服务端零改动（zod `z.string().optional()` / `z.array().optional()` + data 浅合并本就允许空值）。同步更新 `client/src/lib/timeline.test.ts` 旧断言（「清空 → 不提交」改为「清空 → 提交空值」）并新增三字段清空用例。
- 文档：`doc/ui/pages/timeline.md`（详情页字段编辑清空语义）、`doc/api/endpoints.md`（PUT /entity 清空语义说明）——已完成。
- 依赖：无
- 验证：`pnpm --filter client test`（timeline.test.ts）+ `pnpm typecheck && pnpm lint` + 手工走查（编辑清空保存 → 列表行恢复「未标注时间」）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `b3d76c3`；oracle 审核通过——P2 三条补用例已落实：原值缺失+表单有值 / 全空格 trim 等价清空 / 幂等「清空后重复保存不产生多余 patch」；client 测试 473 用例全绿 + typecheck/lint 通过）。

### F2 自动备份检测不到 data.db 变更（Bug，2026-08 用户反馈）

- 范围：`server/src/backup.ts` `hasFileChangesSince`（535-545 行）补查 `data.db-wal` mtime——根因：WAL 模式普通写事务只刷新 `-wal` 伴生文件、主文件 mtime 不变，自动备份永远判定「无变更」；影响所有 data.db 写（实体/关系/Delta/聊天/时间轴）。补查 wal 文件即可（备份时 `checkpointWal` 已保证打包完整）；同步补 `backup.test.ts` WAL 场景用例。
- 文档：decisions.md 决策 27 修订注记（WAL 伴生文件纳入判定，wal 缺失 ≠ 变更）；tasks.md 本卡
- 依赖：无
- 验证：`pnpm --filter server test` + 手工（改时间轴事件 → 等 tick → 检查 `.backups/` 新备份生成）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `2fb0735`；oracle 审核通过——语义/误报/漏检/既有用例兼容逐项核验，P2 两处注释措辞同步已修；server 313 用例全绿 + typecheck/lint 通过）。手工验证指引：`pnpm start:test-project` 后改时间轴事件，等待 ≥ 1 个频率周期（默认 10 分钟，可把 project.json `backup_frequency_minutes` 临时设为 5）检查 `.backups/`。

### F3 垂直时间轴 UI（交互优化，2026-08 用户裁决：垂直轴线 + 时间点分组）

- 范围：`client/src/pages/Timeline.tsx` 列表区从纯 `ul.divide-y` 重构为**垂直时间轴**：左侧时间轴线 + 节点圆点 + 事件行（拖拽柄/名称/时间标签/描述摘要/tags/节点数/⋯ 菜单保持）；排序仍为拖拽 `sort_order` 权威（事件行拖拽模式复用 S13 模式，不因视觉重构改变）。**调研结论（lib-1，2026-08）**：无现成组件可直接引入（shadcn 官方 registry 65 组件与 shadcn-ui-expansions 36 扩展均无 timeline；react-vertical-timeline-component 预打包 CSS 硬编码 #fff 且无分组；antd/MUI/Chakra/daisyUI/flowbite 均重依赖或整体系引入；SAP UI5 有原生 `ui5-timeline-group-item` 分组语义可参考但不引入）→ **自实现**（约 100-150 行，零新依赖，纯 Tailwind 4 + 现有 tokens）。结构参考 creative-tim 分片组件 + hindsight 的 absolute 轴线分组循环：容器 `relative flex flex-col` + 轴线 `absolute left-[11px] top-0 bottom-0 w-0.5 bg-border pointer-events-none`（pointer-events-none 是拖拽共存前提）+ 节点圆点 `relative z-10 rounded-full border-2 border-primary bg-background`（不透明背景盖住轴线）+ 组块（组标题大圆点 + 时间标签 + 计数徽标 + 可选折叠按钮，组内事件堆叠）+ 事件行卡片 `rounded-md bg-card border-border px-3 py-2`；拖拽只设在组块根（组内行不 draggable 防误拖），onDragOver 用 e.clientY 与各组块中点比较算插入位，插入指示 border-t-2 border-primary；分组纯函数与 UI 分离（novu 模式），组序 = 数组线性序。组件切分：`components/timeline/` 下 Timeline.tsx（容器+轴线）/ TimelineGroup.tsx（组块）/ TimelineEvent.tsx（事件行）。视觉全走 tokens（border-border/bg-card/bg-background/text-foreground/text-muted-foreground/rounded-md），**禁硬编码色类**（oracle 审核红线）。
- 文档：`doc/ui/pages/timeline.md`（布局线框 + 交互描述重构）、decisions.md 追加 26 修订注记（UI 形态裁决）
- 依赖：无（lib-1 调研已完成）
- 验证：client 测试（分组/拖拽纯函数）+ 手工走查（轴线渲染/拖拽排序回归/双主题）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `532282a`；oracle 审核 P1 圆点水平居中修复（mx-auto）+ P2-1 mt 几何修正已落实；P2-2 组件切分由 F4 承接；client 475 用例全绿 + typecheck/lint 通过）。

### F4 同时间标签归组（交互优化，2026-08 用户反馈，F3 后续）

- 范围：在 F3 垂直时间轴基础上，同 `time_label` 的事件**归入同一时间点组块**（组标题 = time_label 强调展示，组内事件堆叠，组间按组内最早事件 sort_order 序）；「未标注时间」事件归入独立兜底组（或按 sort_order 平铺）；拖拽跨组重排语义保持（拖拽改 sort_order，组随事件自然迁移）。
- 文档：`doc/ui/pages/timeline.md`（分组交互 + 线框）
- 依赖：F3
- 验证：client 测试（分组纯函数）+ 手工走查（同标签归组/拖拽跨组）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `9eb7660`；oracle 审核通过——无 P0/P1，`groupDropOrders` 经 17,500 例随机暴力交叉验证与服务端 moveEvent 逐次模拟比对 0 失败；P2-1 折叠按钮 `draggable={false}` 防误拖已修，P2-2 亚像素/ P2-3 组间 gap 放置语义忽略；client 488 用例全绿 + typecheck/lint 通过）。

### F5 时间标签字体与颜色强调（交互优化，2026-08 用户反馈）

- 范围：`client/src/pages/Timeline.tsx` 时间标签样式从 `text-xs text-muted-foreground` 提升为醒目样式（token 类内：如 `text-sm font-medium text-foreground` + 主题色点缀/背景 pill），保持 token 体系禁硬编码色类；「未标注时间」占位样式区分。
- 文档：`doc/ui/pages/timeline.md`（信息层级表样式说明）
- 依赖：无（可并行 F3 之后实施，避免同文件冲突）
- 验证：手工走查（浅/深主题下对比度）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `e1673c0`；事件行内时间标签 `text-sm font-medium text-primary`（第二信息层级，与 tags 胶囊/组标题实色均区分）+ 未标注占位 `text-xs italic text-muted-foreground`；仅样式改动零 API 变化，client 488 用例全绿 + typecheck/lint 通过）。

### F6 时间轴列表显示完整描述（交互优化，2026-08 用户反馈）

- 范围：`client/src/pages/Timeline.tsx` 事件行增加 `description` 展示（列表行摘要可见：两行截断 + 展开/收起，或详情行内展示）；`EntitySummary.summary.description` 已含该字段（exp-1 确认，无 API 改动）。
- 文档：`doc/ui/pages/timeline.md`（信息层级表 + 行布局）
- 依赖：无（与 F3/F5 同文件，排在 F3 之后）
- 验证：手工走查（长描述截断/展开）+ 相关 lib 测试（如有）
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `2d12e05`；事件行描述区两行截断 line-clamp-2 + 「展开」仅超两行显示（clamp 态 scrollHeight > clientHeight 运行时测量）+ 收起 + 空描述不渲染；lib 新增 `eventDescription` 防御纯函数 + 测试；oracle 审核 P1 展开态 resize 重测污染修复（guard expanded + 依赖含 expanded）+ P2 四项（useLayoutEffect 消除 CLS / 按钮 draggable={false} / timeline.md 行布局同步 / 纯空白 trim）全部落实；client 489 用例全绿 + typecheck/lint 通过）。

### F7 三栏可收起/展开 + 拖拽调宽（新需求，2026-08 用户反馈）

- 范围：三栏工作台（决策 22「flex-basis 百分比固定不可拖拽」**修订**）：左/中/右栏可拖拽调整宽度（resize 手柄）+ 全部可收起/展开（图标按钮）；宽度与收起态持久化（localStorage，决策 10 同哲学——纯展示层不进数据文件）；`<1024px` 小屏抽屉行为保持。涉及 `AppShell.tsx` / `Sidebar.tsx` / `MainPanel.tsx` / `ChatPanel.tsx` / layout.md 文档。
- 文档：decisions.md 决策 22 修订注记（或新增决策 30）、`doc/ui/layout.md` §0/§2
- 依赖：无
- 验证：手工走查（拖拽/收起/刷新持久化/小屏回归）+ 如有纯函数测试
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `e17132e`；`use-panels` hook：像素宽度 + 收起态 + localStorage `ai-editor:panels` 持久化（解析防御/拖拽中不写存储 endResize 一次写入）+ clamp 区间 左 160-480 / 右 240-720 / 中栏保底 320（480/720 为 2:3 对称设计）+ 默认按视口换算旧 1:5:4；AppShell `ResizeHandle`（pointer capture + select-none + 收起互斥 + 跨断点清理）；左右栏收起 32px 窄条 + 展开按钮、中栏不可收起；`<1024px` 抽屉零改动；oracle 审核 P1 上限契约收敛（400→480）+ P2 三项全部落实；client 497 用例全绿 + typecheck/lint 通过）。

### F8 事件编辑时已存在标签提示（新需求，2026-08 用户反馈）

- 范围：事件表单 `tags` 输入框增加**已存在标签建议**（从全量事件聚合——当前 `collectEventTags` 仅聚合当前列表，需服务端全量或列表全量拉取）；输入匹配提示 + 点选即填（保持逗号分隔输入兼容）。**数据源方案（2026-08 裁决）**：复用现有列表 API `GET /entity/event?limit=200` 拉全量聚合标签池（summary.tags 已含），**零 API 改动**——本地单用户工具事件量远小于 200 上限，YAGNI 不做专用聚合端点；列表页（新建/编辑对话框）可复用已拉取的 items 或补拉全量，详情页（#/timeline/:id 表单）独立补拉全量聚合。
- 文档：`doc/ui/pages/timeline.md`（新建/编辑表单交互：标签输入建议）
- 依赖：无
- 验证：client 测试（匹配/去重/点选纯函数）+ 手工走查
- 回滚：单 commit
- **状态（2026-08）**：✅ 已完成（commit `66227ce`；lib 纯函数 `suggestTags`（最后一段匹配/排除已选/去重/稳定序/limit 5/空段 []/大小写不敏感）+ `applyTagSuggestion`（替换最后一段 + 追加逗号）+ 测试；`TagSuggest` 组件两页共用（卡片样式/hover 高亮/onMouseDown 保焦点/!visible 不渲染）；列表页已拉聚合 + 满页补拉 200、详情页独立补拉 + useDataRefresh 刷新（保存新标签后建议池不陈旧，oracle P2）；oracle 审核通过（无 P0/P1）；client 502 用例全绿 + typecheck/lint 通过）。

### F9 LLM 识别时间标签排序 → 提案确认（新需求，2026-08 用户反馈）

- 范围：AI 工具「按 time_label 语义排序」（决策 26「time_label 不解析」**修订**，决策 14 权限分级）：新增提案类工具 `propose_reorder_events`（args `{ event_ids: string[] }`——LLM 产出有序事件 id 序列）→ 提案卡（预览 = 顺序变化说明）→ 用户确认 → Tool Executor 校验 references（全部事件存在性 + updated_at 快照，409 PROPOSAL_STALE）后**按新序重排 sort_order**（db 层新增批量重排，或复用 moveEvent 逐次——以事务内一次重写为准，拖拽权威语义不变）。**前端**：时间轴页「AI 排序」入口（注入聊天引导 LLM 调用，无直接调工具入口——现有模式一切工具调用走聊天 agent 循环）+ ChatPanel `PROPOSAL_TYPE_LABELS` 中文文案。tool_result 只返回 `{ proposal_id, summary }`（tools.md 2026-08 修订防重复提案）；提案确认成功后 `notifyDataChanged` → Timeline 页 `useDataRefresh` 自动重拉。**与 backlog #15（时间线一致性分析，只读）不同能力**。
- 文档：decisions.md 决策 26 修订注记（F9，已完成）、`doc/api/tools.md`（提案类工具新增 + 执行类新增）、`doc/ui/pages/timeline.md`（AI 排序入口交互）
- 依赖：F3/F4（UI 承载）后实施
- 验证：shared/tools/agent 测试（schema 校验/PROPOSAL_BUILDERS 完整性断言/executor 重排/STALE）+ client 测试（如 PROPOSAL_TYPE_LABELS）+ 手工走查（聊天让 AI 排序 → 提案卡 → 确认 → 时间轴重排；拖拽改序后 AI 排序 STALE）
- 回滚：单 commit（实现分两个 commit：服务端链路 + 前端入口，可按卡拆）
- **状态（2026-08）**：✅ 已完成（commit `2e4297d`；propose_reorder_events 提案工具全链路：shared schema + PROPOSAL_TOOLS/EXECUTOR_TOOLS 登记 + tools build/run（集合完全相等校验/references updated_at 快照/preview.changes 位移说明/tool_result 无预览）+ executor（db reorderEvents 事务重排 sort_order 0..n-1）+ agent PROPOSAL_BUILDERS + server SSE preview 透传 + client「AI 排序」按钮注入聊天 + 提案卡文案；拖拽改序后旧提案 409 PROPOSAL_STALE 闭环；oracle 审核通过（无 P0/P1，P2 五项前三已修）；全仓 1561 用例全绿（shared 131 / llm 59 / db 224 / tools 237 / agent 94 / server 313 / client 503）+ typecheck/lint 通过）。手工验收：`pnpm start:test-project` → 时间轴页「AI 排序」→ 聊天生成提案 → 确认后重排；先拖拽改序再确认 → 409 STALE。