# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、`hooks.md`（伏笔）、`decisions.md`（决策 1-29）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- **推进节奏**：每张卡完成后向用户汇报验证结果，用户确认后开下一张；每切片结束时演示一次端到端功能验收。
- 卡内不做卡外顺手改动；backlog.md 事项一律不做。
- 契约以 `doc/api`、`doc/database` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。

---

## 项目状态（2026-08）

- **完成**：阶段 A 地基 + 切片 1-9、12、13 + 阶段 U（U1-U8）+ 交互修复批次 + 切片 10 画布（S10.1）+ 切片 11 发布（S11.1-S11.3）+ 发布阻断项 E1-E6（导出/导入、未来版本拒绝重建、增量迁移、发布链路 OIDC 全绿）+ 阶段 B（B1 项目提示词编辑）+ 阶段 C 时间轴（C1-C4，决策 26）+ 画布增强批次（S10.2-S10.5）+ 交互优化批次（UX1-UX4）+ 阶段 B2 自动备份与恢复（B2.1-B2.6，决策 27/28/29）+ **用户反馈批次一 F1-F9（2026-08 实测）** + **用户反馈批次二 G1-G3（G1 区块独立滚动 / G2 时间标签点实体化 / G3 滚动位置保持，2026-08 实测）** + **用户反馈批次三 H1-H6（时间轴交互与视觉优化，2026-08 实测）** + **用户反馈批次四 I1-I4（实体关系增强，2026-08 实测，决策 30）**：occurs_in 中文映射补齐（bug）/ 详情图标统一 Eye（UX）/ 设定层级 = belongs_to 关系（parent_id 废弃，防环校验 + 层级区块 + 新建行上级设定选择器）/ 设定树视图（第 6 tab）。
- **待做**：无。可选收尾：npm 坏版本 v0.0.1/v0.0.2 deprecate 标注（需 2FA 凭据，见 AGENTS.md 发布流程段）；backlog.md 事项一律不做。
- **测试**：全仓 1603 个（shared 131 / llm 59 / db 241 / server 325 / client 516 / tools 237 / agent 94）。
- 已完成卡片的详细规格已归档（git history 可回溯，见下方「任务卡归档」）；「项目演进路线」提供脉络摘要，配合 `decisions.md`（决策 1-29 为设计主轴）理解现状。

## 执行进度（Todo）

- [x] 阶段 A 地基（T0-T7）· 切片 1 项目管理 · 2 大纲 · 3 实体与关系 · 4 回收站 · 5 Delta
- [x] 切片 6 模型与工具层（S6.1-S6.7）· 7 对话服务（S7.1-S7.6）· 8 聊天联调 · 9 伏笔面板
- [x] 切片 12 大纲节点详情（决策 23）· 13 大纲交互重构
- [x] 阶段 U UI 工作台重构（U1-U8）· 交互修复批次（数据刷新信号/会话恢复/ErrorBoundary/Base UI #31）
- [x] S10.1 画布页 · 画布增强批次（S10.2-S10.5）· 交互优化批次（UX1-UX4）
- [x] S11.1 生产构建全链路 · S11.2 端到端冒烟 · S11.3 发布前复审
- [x] E1-E3 导出/导入 · E4 未来版本拒绝重建 · E5 增量迁移机制 · E6 发布链路（OIDC 全绿，v0.0.4-v0.0.7）
- [x] B1 项目提示词编辑器（决策 24/25）
- [x] 阶段 C 时间轴（C1-C4，决策 26）
- [x] 阶段 B2 自动备份与恢复（B2.1-B2.4，决策 27）· B2.5 备份命名增强（决策 28）· B2.6 备份类型标签 + 重命名（决策 29）
- [x] 用户反馈批次一 F1-F9（Bug：F1 事件字段清空 / F2 备份漏检 data.db-WAL；交互：F3 垂直时间轴 UI / F4 同标签归组 / F5 标签样式 / F6 行内描述；新需求：F7 三栏收起拖宽 / F8 标签输入建议 / F9 LLM 排序提案）
- [x] 用户反馈批次二 G1 区块独立滚动 · G2 时间标签点实体化（G2.1 数据层 / G2.2 服务端与AI / G2.3 前端重构 / G2.4 收尾）
- [x] 用户反馈批次三 G3 操作后滚动位置保持
- [x] 用户反馈批次三 H1-H6 时间轴交互与视觉优化（删除入口/免确认/按钮展开/边框/右移/图标）
- [ ] 用户反馈批次五（2026-08，输入提示与标签筛选，决策 31）：J1 设定分类统一为 tags（category 废弃）· J2 datalist 自动完成提示 · J3 设定列表标签筛选 + 新建行布局
  - [x] J1 设定分类统一为 tags：shared 移除 settingDataSchema.category + db 摘要改 tags + client 列表列/新建行/详情字段/Delta 清单移除 category + 文档 & 测试
  - [x] J2 datalist 自动完成（浏览器原生候选：新建行名称/首字段聚合 + 设定详情 rules 标签 + 伏笔类别枚举）
  - [x] J3 设定列表标签筛选（REST tag 参数 + 前端标签下拉聚合 + 新建行布局整理）
- [ ] 用户反馈批次四（2026-08，实体关系增强）：I1 `occurs_in` 中文映射补齐（bug）· I2 详情图标统一 Eye（UX）· I3 设定层级 = belongs_to（决策 30，新需求，含 #3 UX 修复）· I4 设定关系视图（新需求，#6）
  - [x] I1 `occurs_in` 中文映射（RELATION_TYPE_LABEL 补 17 种「锚定于」+ 测试 + 文档）
  - [x] I2 详情图标 BookOpen → Eye（HookPanel / Outline）
  - [x] I3a 数据与校验层：shared 移除 settingDataSchema.parent_id + db 层级邻接表/防环 helper + server POST /relation 校验 + tools R5 调整 + 测试 & 文档
  - [x] I3b 客户端 UI：detailFieldsForType 移除 parent_id + 详情页「层级」区块（父/子 + 修改上级）+ 新建行「上级设定」弹层选择器 + 测试
  - [x] I4 设定树视图（决策 30：第 6 tab「设定树」，buildSettingTree 纯函数 + 递归树渲染 + 折叠/跳详情）

---

## 项目演进路线（2026-08，已完成工作摘要）

> 供后续理解项目脉络；每项一行 = 目标 + 关键决策（决策编号见 `decisions.md`）。详细契约以 `doc/api`、`doc/database`、`doc/ui` 各文档为准。

**阶段 A：地基**（T0-T7）——pnpm 7 包 monorepo（shared → llm/db/tools → agent → server，client 只依赖 shared）；shared 纯类型/常量/纯函数（zod 仅服务端经 `./schemas` 子路径导出，client 打包安全）；vitest/tsc/eslint 三件套；schema 演进删库重建（决策 13）；存储三文件（outline.json / data.db / project.json）原子写（决策 11）。

**切片 1-5（项目管理/大纲/实体关系/回收站/Delta）**——create/open/close/config + 书架模式（books/，决策 8 修订）+ 启动待命语义；大纲严格三层卷→章→场景、无游离节点（决策 19）；四类实体（人物/设定/地点/伏笔）CRUD + 通用关系表 `relation_records`（决策 2，含 plot_edge）+ k 跳遍历 + 软删级联（决策 12）；回收站还原/purge + 启动一致性校验兜底（决策 16 修订）；`delta_records` 独立表 + computeState 只沿大纲树父链累积已确认 Delta（决策 9：op=update from 校验失败跳过 + conflicts 标注）。

**切片 6 模型与工具层**——LLM 客户端（fetch → DeepSeek 手写 SSE 解析/[DONE] 哨兵/abort 三保险/length 截断防御）；重试分类（配额/计费不可重试、指数退避、abort 永不重试）；token 估算；**工具注册**（查询 8/分析 5/伏笔 5/提案 15/执行 13）——SQL 一律下沉 db 查询层、提案仅产出对象零落盘（决策 14）、执行类不暴露 LLM。

**切片 7-9（对话/聊天/伏笔）**——会话管理（决策 18：tool_call/tool_result 成对裁剪、孤儿整对丢弃）；上下文组装（决策 6/7 分层注入 + 预算）；runAgent 三重保险（8 轮/120s/token）六类事件序列；提案仓（TTL 10min/上限/项目绑定）+ 快照重校验（决策 14/19）；chat SSE 路由（心跳/三路断开检测/全链路取消，决策 16/20）；提案卡接入（confirm/reject 三错误码分支）；伏笔分组列表 + 复合写确认面板 + 依赖链递归展开 + 大纲节点伏笔标记（**MVP 简化：不展示 _health 与章节序**，backlog #13）。

**切片 12/13（2026-08 用户反馈）**——节点结构化 data（决策 23 麦基《故事》字段集）+ `#/outline/:nodeId` 详情页；大纲交互重构（操作平铺图标化/拖拽上下半排序/摘要独立行）。

**阶段 U：UI 工作台重构**（U1-U8，决策 22 + F7 修订）——三栏 1:5:4 布局（左书架树/中信息条+7 tab/右 ChatPanel 常驻，`<1024px` 抽屉；**F7 起可拖拽调宽 + 收起/展开**，use-panels + localStorage 持久化）；shadcn 集成 + oklch 文学氛围双主题；会话归属项目；全局反馈（toast/错误横幅/确认对话框）。

**切片 10 画布 + 增强批次（S10.1-S10.5）**——大纲节点画布投影（确定性树布局/localStorage 坐标防抖/缩放/仅场景模式）；plot_edge 连线创建与删除 + 语义色三级优先级 + 箭头 + 流动虚线；小地图（自研零依赖）；「一键重排」（`mergeLayout` 幂等——已存坐标保留仅新节点补位）；hover 路径 DFS 高亮（非路径降透明 0.2）；**UX1 拖出即连 + 连线标签线上编辑（`PUT /relation/:id`）**。

**切片 11 发布 + E1-E6（2026-08）**——生产构建全链路 + 端到端冒烟（9 步链路 123+ 断言）+ 发布前复审；导出/导入（E1-E3：fflate zip 三文件 + wal_checkpoint 快照 / import 校验 + 原子搬入 / 书架 UI）；schema 安全（E4 未来版本拒绝重建 / E5 增量迁移机制）；发布链路（E6：6 包 npm 发布 + OIDC Trusted Publisher + CI 全绿 **v0.0.4-v0.0.7**）。发布管道坑记录见文末。

**阶段 B：项目提示词编辑**（B1，决策 24/25）——创作伴侣定位（不编辑/存储/读取正文，AI 基于结构化数据建议）；项目 `prompt` 字段（跟随书籍）是唯一持久化上下文通道，设置页编辑 UI（按项目身份载入防写错、空值清除、无项目禁用）。

**阶段 C：时间轴（C1-C4 + F3-F6 + G2，决策 26）**——第 5/6 种实体类型 `event`（`ev-`）/ `timepoint`（`tp-`，**G2 时间标签点实体化**：name = 时间标签文本，data 空）；`occurs_in` 关系锚定大纲节点 + **`occurs_at` 关系挂载事件到时间点（1:n）**；**双独立线性序**（timepoint.sort_order 组间序 + event.sort_order 组内排序键，拖拽时间点不动其下事件序）；SCHEMA_VERSION 1→2→3（002/003 迁移，E5 首个真实用例）；列表页 `#/timeline`（垂直时间轴 + 时间点组块 + 未挂载兜底区 + **双轨拖拽**：时间点整组 / 事件单条跨组改挂载 `POST /event/:id/move_to` 复合端点）+ 详情页（字段编辑 + occurs_in 关联 + **挂载时间点选择器**）；AI 工具 `propose_reorder_timepoints`（LLM 按时间点语义排序提案确认，G2 取代 F9 的 propose_reorder_events）；**MVP 无 AI 一致性分析工具**（backlog #15）。

**阶段 B2：自动备份与恢复**（B2.1-B2.6，决策 27/28/29）——备份/频率/列表均项目级：自动备份定时器（有变更才备份：三文件 mtime + **data.db-wal 伴生文件**（F2 修复）+ 1s 容差；`.backups/` 保留 20 份）；频率 = project.json `backup_frequency_minutes`（缺省 10，枚举）；**唯一 key = project_id**（zip 内 id 匹配 → 覆盖恢复保留 id 防会话断连 + 覆盖前自动快照 / 不匹配 → 导入新书，同名不再 409）；重命名书名（原子移动目录）；文件名毫秒精度 `<YYYYMMDD-HHmmssSSS>[-<kind>][-<名称>].zip`（决策 28/29：自定义名称 + 手动/自动 kind 标记段 + `POST /backup/rename`，旧格式兼容解析不迁移）。

**用户反馈批次一（F1-F9，2026-08）**——F1 事件字段清空语义（空值提交即清除）；F2 自动备份补查 `data.db-wal`（WAL 模式写只刷新伴生文件，主文件 mtime 不变导致漏检——影响全部 data.db 写）；F3-F6 时间轴视觉重构（垂直轴线+节点 / 同标签归组 / 时间标签样式强调 / 行内完整描述展开收起）；F7 三栏可收起/拖宽（use-panels）；F8 标签输入建议（suggestTags + TagSuggest）；F9 LLM 时间标签排序提案（propose_reorder_events，G2 后被 timepoints 版取代）。

**用户反馈批次二（G1-G3，2026-08）**——G1 时间轴区块独立滚动（header/筛选器固定，仅列表区滚动）；G2 时间标签点实体化（决策 26 重大修订，四卡：G2.1 数据层 003 迁移 / G2.2 服务端 move_to 复合端点 + 工具替换 / G2.3 前端双实体 UI + 双轨拖拽 / G2.4 收尾）；G3 操作后滚动位置保持（重拉期间保留旧数据渲染，`!loading` 从列表条件移除）。

**用户反馈批次三（H1-H6，2026-08）——时间轴交互与视觉优化**：H1 时间点删除入口补齐；H2 软删/还原免二次确认；H3 操作按钮全部展开（禁止 `...` 菜单）；H4 时间轴新建事件按钮横向排布 + 全仓文字按钮加边框；H5 时间轴标题行信息与操作右移 + 重命名/新建事件改图标按钮；H6 事件行「N 节点」计数靠右。

**用户反馈批次四（I1-I4，2026-08）——实体关系增强（决策 30）**：I1 关系类型 `occurs_in` 中文映射补齐（17 种「锚定于」，与 occurs_at「发生于」区分）；I2 详情入口图标 BookOpen 统一为 Eye；**I3 设定层级 = `belongs_to` 关系（决策 30：`data.parent_id` 废弃不再读写，zod 移除定义 + R5 仅保留 location + 无迁移，旧字段 passthrough 容错）**——db 全量层级边邻接表（`listSettingHierarchyEdges`，走关系表索引）+ 防环校验（`wouldCreateSettingCycle` 祖先链 O(深度)）、server `POST /relation` 对 belongs_to 两端均为 setting 的 400 校验（自指/成环）、客户端详情页「层级」区块（父/子分区 + 修改上级先建后删 + 清除）+ 新建行「上级设定」弹层搜索选择器（创建后补建关系）；I4 设定树视图——实体关系第 6 tab「设定树」（`buildSettingTree` 纯函数：根 = 无父设定、父截断提升为根防御；递归树 + 折叠 + 类别徽标 + 子数 + 跳详情）。

---

## 任务卡归档（已完成，详细规格见 git history）

> 每卡 = 实现 commit（docs 收官 commit 略）；oracle 审核无 P0/P1 遗留（P2 已处理或记入后续卡）。详细卡规格、坑记录与提交历史可 `git log` 回溯。

| 批次 | 卡 | 实现 commit | 要点 |
|------|----|------------|------|
| 地基/切片 | T0-T7 / S1-S13 | git log 回溯 | 地基 + 项目管理/大纲/实体/回收站/Delta/工具层/对话/聊天/伏笔/节点详情/大纲重构 |
| 阶段 U | U1-U8 | git log 回溯 | 三栏工作台重构 + 双主题 + 会话归属项目 |
| 画布 | S10.1 | git log 回溯 | 画布投影 + 连线 + 坐标持久化 |
| 画布增强 | S10.2-S10.5 | git log 回溯 | 连线质量/小地图/重布局/hover 路径 |
| 交互优化 | UX1-UX4 | git log 回溯 | 拖出即连/行内新建/轻量弹层 |
| 发布 | S11.1-S11.3 | git log 回溯 | 构建全链路/冒烟/复审 |
| 阻断项 | E1-E6 | git log 回溯 | 导出导入/未来版本拒绝/增量迁移/发布链路（坑记录见文末） |
| 阶段 B | B1 | `66785bc` | 项目提示词编辑器 |
| 阶段 C | C1-C4 | git log 回溯 | 时间轴事件实体 + 排序 + 锚定 |
| 阶段 B2 | B2.1-B2.4 | `0f1cc92`/`cf51cfe`/`16a312d`/`0ce5f4d` | 自动备份 + 恢复 + import 分流 |
| B2.5 | 备份命名增强 | `2d8e5eb` | 毫秒精度 + 自定义名称（决策 28） |
| B2.6 | 备份类型标签 + 重命名 | `544769e` | kind 标记段 + POST /backup/rename（决策 29） |
| F1 | 事件字段清空语义 | `b3d76c3` | Bug：空值提交即清除 |
| F2 | 备份漏检 data.db-WAL | `2fb0735` | Bug：补查 `-wal` mtime |
| F3 | 垂直时间轴 UI | `532282a` | 交互：轴线 + 节点 + 事件卡 |
| F4 | 同标签归组 | `9eb7660` | 交互：组块 + 组块级拖拽（17,500 例暴力验证） |
| F5 | 时间标签样式 | `e1673c0` | 交互：主题色点缀 + 未标注占位 |
| F6 | 行内完整描述 | `2d12e05` | 交互：两行截断 + 展开/收起 |
| F7 | 三栏收起/拖宽 | `e17132e` | 新需求：use-panels + 持久化（决策 22 修订） |
| F8 | 标签输入建议 | `66227ce` | 新需求：suggestTags + TagSuggest |
| F9 | LLM 排序提案 | `2e4297d` | 新需求：propose_reorder_events（G2 后换 timepoints 版） |
| G1 | 区块独立滚动 | `6f81a99` | 交互：header/筛选器固定 |
| G2.1 | 数据层 | `33b1a5f` | timepoint 实体 + occurs_at + SCHEMA_VERSION 3 迁移 |
| G2.2 | 服务端与 AI | `a324fdd` | move 端点 + move_to 复合 + 工具替换 |
| G2.3 | 前端重构 | `4278c9c` | 双实体 UI + 双轨拖拽 + 双入口 |
| G2.4 | 收尾 | `4be73d5` | 文档与状态同步 |
| G3 | 操作后滚动位置保持 | `f50bae6` | 交互：重拉期间保留旧数据渲染 |
| H1-H6 | 时间轴交互与视觉优化 | git log 回溯 | 删除入口/免确认/按钮展开/边框/右移/图标 |
| I1 | `occurs_in` 中文映射（bug） | `2563dec` | 17 种关系类型映射补全，「锚定于」与「发生于」区分；测试 + entity-list.md 补映射表 |
| I2 | 详情图标统一 Eye（UX） | `75bdf8d` | BookOpen → Eye（Outline/HookPanel 详情入口）；Sidebar/Dashboard 书籍语义保留；outline.md 同步 |
| I3a | 设定层级 = belongs_to（决策 30）数据/校验层 | `5e1a831` | shared 移除 settingDataSchema.parent_id；db 层级邻接表/防环 helper；server POST /relation 自指/成环 400；tools R5 仅保留 location；文档 decisions 30 + schema/endpoints/UI |
| I3b | 设定层级客户端 UI（决策 30） | `d6e5c19` |
| I4 | 设定树视图（决策 30） | 本次 | 实体关系第 6 tab「设定树」；buildSettingTree 纯函数（根判定/截断孤儿提升）；递归树渲染 + 折叠 + 类别徽标 + 子数 + 跳详情；路由拦截 + 测试 +5 | detailFieldsForType 移除 parent_id；详情页「层级」区块（父/子分区 + 修改/清除上级，先建后删）+ 关联列表过滤层级边；新建行「上级设定」弹层搜索选择器 + 创建后补建 belongs_to；lib helper + 测试 |

---

## 发布管道坑记录（E6 遗留，供后续发布参考）

- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证** → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN` 优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- registry 文档缓存传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ verify-installed 演进：5×15s → 10×30s → **v0.0.7 改为先 `npm view` 轮询 6 包可见（20×30s = 10 分钟窗口）再 install**
- automation token（绕过 2FA）不能执行 unpublish/deprecate（npm 安全策略 403）→ 需 2FA 凭据或网页操作
