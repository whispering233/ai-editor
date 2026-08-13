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

- **完成**：阶段 A 地基 + 切片 1-9、12、13 + 阶段 U（U1-U8）+ 交互修复批次 + 切片 10 画布（S10.1）+ 切片 11 发布（S11.1-S11.3）+ 发布阻断项 E1-E6（导出/导入、未来版本拒绝重建、增量迁移、发布链路 OIDC 全绿）+ 阶段 B 项目提示词编辑（B1，决策 24/25）+ **阶段 C 时间轴（C1-C4，决策 26）** + 画布增强批次（S10.2-S10.5，inkos 参考）+ 交互优化批次（UX1-UX4，用户实测反馈）+ **阶段 B2 自动备份与恢复（B2.1-B2.4，决策 27）**——详见「项目演进路线」。
- **待做**：无（MVP 与阶段 A/B/C/B2 全部完成；可选收尾 = npm 坏版本 v0.0.1/v0.0.2 deprecate 标注——需 2FA 凭据，见 E6 卡）；backlog 事项一律不做。
- **测试**：全仓 1387 个（shared 94 / llm 59 / db 218 / server 253 / client 444 / tools 225 / agent 94）。
- 已完成卡片的详细规格已归档（git history 可回溯）；「项目演进路线」提供脉络摘要，配合 `decisions.md`（决策 1-26 为设计主轴）理解现状。

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
- [x] 阶段 B2 自动备份与恢复（B2.1 契约与配置 / B2.2 备份管道+定时器+端点 / B2.3 import 分流+rename / B2.4 client 备份区+书架）

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
> **状态（2026-08）**：✅ B2.1-B2.4 已完成（决策 27 落地；oracle 审核通过）。提交：B2.1 契约 `0f1cc92` / B2.2 备份管道 `cf51cfe`（审核 P1 修复 `6823c4b`）/ B2.3 分流改造 `16a312d`（契约同步 `a5e9836`）/ B2.4 client `0ce5f4d`（审核 P2 修复 `49d44d5`）；全仓测试 green（shared 107 / llm 59 / db 219 / server 286 / client 462 / tools 225 / agent 94）。

> **各卡详细规格已归档（git history 可回溯）**——B2.1 shared 契约与配置 / B2.2 自动备份管道 + 定时器 + 备份管理端点 / B2.3 import 分流改造 + rename / B2.4 client 设置页备份区 + 书架改造；实现摘要见上方「项目演进路线」B2 段。
