# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、`decisions.md`（决策 1-44）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；backlog.md 事项一律不做。
- 契约以 `doc/api`、`doc/database` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证（含 oracle 审验）后合回 main 清理分支（批次八起实践）。

---

## 项目状态（2026-08-23，v0.0.20 已发布）

全量交付完成：阶段 A 地基（T0-T7）+ 切片 1-13 + 阶段 U 三栏工作台（U1-U8）+ 画布 S10（批次八 O6 已按决策 33 移除）+ 发布 S11 + 发布阻断项 E1-E6 + 阶段 B/C/B2 + 用户反馈批次一至十四（F1-F9 · G1-G3 · H1-H6 · I1-I4 · J1-J3+K1/K2 · M1-M3 · N1-N2 · O1-O6 · L 样式工程化 + 批次九至十四，详见执行进度与演进路线）+ **发布 v0.0.1-v0.0.20 全链路全绿**。**批次十四（2026-08 已完成并发布 v0.0.20：决策 47 工具调用展示人类可读化（names/resolve 批量名称解析 + 摘要渲染）/ 决策 48 用户级配置格式正式化 schema v1（多供应商 v2 用户裁决放弃，记录 backlog #17）/ 决策 27 修订备份频率新增 1 分钟档，任务卡 14.1-14.5）**。可选收尾：npm 坏版本 v0.0.1/v0.0.2 deprecate 标注（需 2FA 凭据）；backlog.md 事项一律不做。

- **设计主轴**：`decisions.md` 决策 1-48；架构分包见 `architecture.md`；文档即契约（`doc/api`、`doc/database`、`doc/ui`）。
- **测试**：全仓 1690 个（shared 156 / llm 41 / db 258 / server 383 / client 516 / tools 242 / agent 94）。SCHEMA_VERSION = 5（决策 36/43/46：kind 与 setting sort_order 均为 JSON/列语义演进，无 DDL 迁移）。

## 执行进度（全部完成）

- [x] 历史批次（git log / CHANGELOG 回溯规格）：阶段 A + 切片 1-13 · 阶段 U · 画布 S10（O6 移除）· 发布 S11 + E1-E6 · 阶段 B/C/B2 · 批次一至六（F1-F9 · G1-G3 · H1-H6 · I1-I4 · J1-J3+K1/K2 · M1-M3）· L 批次（L1-L4）· 批次七（N1-N2，决策 32）
- [x] **批次八至十三（2026-08，发布 v0.0.14-v0.0.19）**：O1-O6 画布移除（决策 33）/ 批次九（决策 34/35/36，v0.0.15）/ 批次十（决策 37-42，v0.0.16）/ 批次十一（决策 43，v0.0.17）/ 批次十二（决策 44 + R1-R6 + T1-T3，v0.0.18）/ 批次十三（决策 45/46，v0.0.19）——各卡规格、坑记录与提交历史 `git log` 回溯（commit 见 CHANGELOG.md / release-review.md）
- [x] **批次十四（决策 47/48 + 决策 27 修订，2026-08，发布 v0.0.20）**：14.1 `POST /api/v1/names/resolve` 批量名称解析端点（按 id 前缀分流查库，rel-/未知/软删 → null）`3d12c8b` / 14.2 工具调用展示人类可读化（`summarizeToolCall`/`summarizePreview` 摘要渲染 + ToolCallRow 展开态批量解析 id 显示名称 + 提案卡 preview 摘要化 + 历史回放同路径 + 回退 JSON 兜底）`4345643` + formatValue 对象数组 → 项数补充修复 `e07c0ac` / 14.3 备份频率新增 1 分钟档（`BACKUP_FREQUENCIES` 加 1，纯增量）`f9b0fa3` / 14.4 用户级配置格式正式化 schema v1（`userConfigFileSchema` 宽松读取 + 读侧兼容不写回 + 保存时自然升级）`253153e` / 14.5 收官文档（本卡）`4d2b85d`；14.1-14.4 均经 oracle 独立验证无阻断项

> 各卡详细规格、坑记录与提交历史可 `git log` 回溯（commit 见 CHANGELOG.md / release-review.md 发布进展记录）。

---

## 项目演进路线（脉络摘要）

> 供后续理解项目脉络；每项一行 = 目标 + 关键决策（决策编号见 `decisions.md`）。详细契约以 `doc/api`、`doc/database`、`doc/ui` 各文档为准。

**阶段 A：地基**（T0-T7）——pnpm 7 包 monorepo（shared → llm/db/tools → agent → server，client 只依赖 shared）；shared 纯类型/常量/纯函数（zod 仅服务端）；vitest/tsc/eslint；schema 演进（决策 13）；存储三文件原子写（决策 11）。

**切片 1-5**——项目管理/大纲（严格三层卷→章→场景，决策 19）/实体（四类 + 通用关系表 `relation_records`，决策 2）/回收站（软删级联，决策 12）/Delta（独立表 + computeState 沿父链累积，决策 9）。

**切片 6-9**——LLM 客户端 + 工具注册（查询/分析/伏笔/提案/执行）；会话管理与成对裁剪（决策 18）；上下文分层注入（决策 6/7）；agent 三重保险（8 轮/120s/token）；提案仓仅内存 + 快照重校验（决策 14/19）；chat SSE（心跳 + 三路断开检测，决策 16/20）；伏笔面板（MVP 简化：不展示 _health 与章节序，backlog #13）。

**切片 12/13**——节点结构化 data（决策 23 麦基字段集）+ 节点详情页；大纲交互重构（操作平铺图标化/拖拽排序/摘要独立行）。

**阶段 U：UI 工作台重构**（U1-U8，决策 22 + F7 修订）——三栏 1:5:4 布局（左书架/中信息条 + 7 tab/右 ChatPanel 常驻，可拖拽调宽 + 收起）；shadcn + oklch 文学氛围双主题；会话归属项目；全局反馈。

**画布 S10 + 增强（S10.1-S10.5 + UX1-UX4）→ 批次八 O6 已移除（决策 33）**——大纲节点画布投影 + plot_edge 连线 + localStorage 坐标（决策 10）；**2026-08 按用户裁决删除画布页与全部画布代码**（1000 章后无实际价值），plot_edge 数据/接口能力保留（仅无 UI 入口）。

**阶段 B/C/B2**——B1 项目提示词编辑（决策 24/25：创作伴侣定位，不编辑/存储/读取正文）；C 时间轴（决策 26 + G2：timepoint 实体 + occurs_at 挂载 + 双独立线性序 + SCHEMA_VERSION 3）；B2 自动备份与恢复（决策 27/28/29：项目级频率/命名 kind 标记/重命名、project_id 唯一 key 覆盖分流、`.backups/` 保留 20 份）。

**用户反馈批次一至八（2026-08，含 L 样式工程化）**——F1-F9（字段清空语义/备份 WAL/时间轴视觉重构/三栏收放/标签建议/LLM 排序）；G1-G3（区块滚动/时间标签点实体化/滚动保持）；H1-H6（时间轴交互：删除入口/免确认/按钮展开/边框/右移/图标）；批次四 I1-I4（决策 30：设定层级 = belongs_to）；批次五 J1-J3 + K1/K2（决策 31：分类统一 data.tags，SCHEMA_VERSION 4，datalist 自动完成 + ?tag= 筛选）；批次六 M1-M3（标签编辑器回车/上级+描述行/标签拖拽排序）；批次七 N1-N2（决策 32：设定列表上级设定筛选——递归子树）；**批次八 O1-O6（决策 33，画布移除）**——O1 设定筛选可搜索下拉 / O2 大纲操作区右移+去时间戳 / O3-O4 时间轴拖拽柄无视觉 + 折叠按钮左移 / O5 设定树全部展开折叠 / O6 画布页移除。

**发布与阻断项（E1-E6，2026-08）**——导出/导入（E1-E3：fflate zip 三文件）、schema 安全（E4 未来版本拒绝重建 / E5 增量迁移）、发布链路（E6：6 包 npm + OIDC Trusted Publisher + CI 全绿，v0.0.1-v0.0.14）。发布管道坑记录见文末。

**批次九（2026-08 已完成并发布 v0.0.15：决策 34 pi-ai 引擎换核 / 决策 35 工具核查与中栏演进 / 决策 36 参考资料页）**——llm 引擎换核（引入 @earendil-works/pi-ai 替换手写 SSE/流式累积；agent 394+ server 层契约零破坏；getAvailableModels 模型目录）；右栏增强（模型选择 / 思考强度 low·medium·high / 上下文占用条 usage÷contextWindow）；参考资料第 7 实体类型（SCHEMA_VERSION 5 + search_references / propose_create_reference 工具 + TabBar/列表/详情页）；InfoBar 问 AI 统一入口 + 页面焦点上报（决策 35：入口集中化，页面零按钮只上报 currentFocus）；全仓 1555 测试全绿

**批次十（2026-08 已完成并发布 v0.0.16：决策 37-42）**——大纲交互优化（决策 37：移除详情/新建按钮、Enter 创建子级、双击详情、点击标题编辑、只留删除）；时间轴交互参考大纲（决策 38：事件行+组标题行双击详情/点击编辑、移除详情/编辑按钮）；移除实体列表更新时间（决策 39：EntityList 去更新时间列与排序，详情页保留）；右键菜单替代行级问 AI（决策 40：删除 6 处 AskAiButton，右键菜单含注入会话上下文 + 建立关联，InfoBar 入口保留）；项目规则文件 AGENTS.md（决策 41：唯一事实源 + prompt 自动迁移 + 设置页直编 + 外部修改检测，修订决策 25）；实体设定页树形视图（决策 42：与设定树合并、折叠/展开/行内编辑/拖拽/Enter 新建/双击详情、搜索+标签树内过滤、移除分页）。

**批次十一（2026-08 已完成并发布 v0.0.17：决策 43 参考资料两类承载）**——本地 md 文件（YAML frontmatter 自包含 + mtime 快照同步 + references/ 目录）与外源链接（URL 必填仅索引）两类承载；文件 = 真相源、DB 索引 = 派生镜像（应用内编辑先写文件后更新 DB，外部编辑靠 scan 幂等全量比对自愈）；新建入口分流两按钮；列表交互对齐决策 37/38（点击标题编辑/双击详情/只留删除/右键菜单复用决策 40）；详情页内嵌 markdown 编辑器（@uiw/react-md-editor + react-markdown，调研选型）+ 导入 md + 关联面板；存档体系扩展打包 references/；B1 列表编辑对话框竞态随重构根除；跨书籍导入记录 backlog #16 未来迭代。

**批次十三（2026-08 已完成并发布 v0.0.19，决策 45/46：人物列表行信息修订 + 设定树手动排序）**——状态列移除且详情页表单一并移除（存量 data.status 容错保留）/ 人物行四列布局（名称+动机第二行 / 角色 / 性格 / 能力独立成列——用户复核修订首版两行式，toSummary 扩展 motivation 截断 40 + personality·abilities 各前 2）/ 设定树行描述摘要展示（summary.description 弱化行 + hover 完整）/ 设定树排序（修订决策 42「无 sort_order」约束：同级组内线性序复用 entities.sort_order 列零迁移、EntitySummary.sortOrder 仅 setting 填充、复合端点 PUT /entity/setting/:id/move 改父+重排一次事务（防环沿用决策 30，删旧边按 target_id=旧父 精确匹配）、排序方式切换器 名称/创建时间/手动、手动模式 ↑↓ 箭头 + 行间插入线拖拽重排（order = 移除自身后组内位置语义）、拖到行中段仍 = 调层级）。

**批次十四（2026-08 已完成并发布 v0.0.20，决策 47/48 + 决策 27 修订：工具调用展示人类可读化 + 备份 1 分钟档 + 配置格式 schema v1）**——会话中工具调用行/提案卡不再 JSON dump 原始参数（含裸 id）：新增 `POST /api/v1/names/resolve` 批量名称解析端点（按 id 前缀分流查库，rel-/未知/软删 → null）+ client summarizeToolCall/summarizePreview 摘要渲染（ToolCallRow 展开态批量解析 id 显示名称、提案卡 preview 摘要化、历史回放同路径、解析失败/未知工具回退原始 JSON 兜底）；备份频率新增 1 分钟档（BACKUP_FREQUENCIES = [1,5,10,15,30,60]，纯增量，决策 27 修订）；用户级配置格式正式化 schema v1（shared userConfigFileSchema：schema_version=1 可选 + model/thinking_level/api_key，宽松读取未知字段保留，旧格式读侧兼容不写回、设置页保存时自然升级；多供应商 v2 用户裁决放弃，记录 backlog #17）。

---

## 发布管道坑记录（E6 遗留，供后续发布参考）

- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证** → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN` 优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- registry 文档缓存传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ verify-installed 演进：5×15s → 10×30s → **v0.0.7 改为先 `npm view` 轮询 6 包可见（20×30s = 10 分钟窗口）再 install**
- automation token（绕过 2FA）不能执行 unpublish/deprecate（npm 安全策略 403）→ 需 2FA 凭据或网页操作
