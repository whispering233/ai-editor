# 开发任务清单（Task Cards）

MVP 开发任务卡，**垂直切片**组织：地基（一次性基础设施）后，每个切片 = 一个端到端功能（后端 → API 路由 → 前端页面），切片完成即可独立演示验证。依据：`architecture.md`（分包/命令）、`endpoints.md`（API 契约）、`schema.md`（数据结构）、`tools.md`（工具目录）、详细设计四篇（`data-model.md`/`context.md`/`agent-loop.md`/`security.md`）。

**执行纪律**：
- 一次只做一张任务卡，验证通过（含测试）才算完成，然后独立 commit（一张卡一个 commit，回滚 = revert 该 commit）。
- 卡内不做卡外顺手改动；backlog.md 事项一律不做。
- 契约以 `doc/api`、`doc/database` 为准，发现文档矛盾先停下提问，不要自行发明。
- 测试框架：vitest（各包独立 `test` script，`pnpm --filter <包> test`）。
- 并行卡片在临时分支 + 临时 git worktree（`worktree: true`）开发，父会话验证（含 oracle 审验）后合回 main 清理分支。

---

## 项目状态（2026-09-05，v0.0.24 已发布）

全量交付完成并发布 **v0.0.1-v0.0.24 全链路全绿**：阶段 A 地基 + 切片 1-13 + 阶段 U 三栏工作台 + 画布 S10（批次八 O6 移除）+ 发布 S11 + 导出/导入 + schema 演进安全（未来版本拒绝 / 增量迁移）+ 阶段 B 提示词编辑 + 阶段 C 时间轴 + 阶段 B2 自动备份 + 用户反馈批次一至十五 + 样式工程化 L + db 查询层 drizzle 化 + 文档体系重构（详细设计四篇，v0.0.23）+ 批次十六多 provider（v0.0.24）。**无待做项**；backlog.md 事项一律不做。

---

- **设计主轴**：详细设计见 `data-model.md`/`context.md`/`agent-loop.md`/`security.md`；架构分包见 `architecture.md`；文档即契约（`doc/api`、`doc/database`、`doc/ui`）。
- **测试**：全仓 1702 个（shared 157 / llm 46 / db 260 / server 387 / client 516 / tools 242 / agent 94）。SCHEMA_VERSION = 5（JSON/列语义演进无 DDL 迁移）。

## 执行进度（全部完成）

- [x] 全部计划批次完成——各卡详细规格、坑记录与提交历史 `git log` 回溯（commit 见 CHANGELOG.md 各版本段）；演进脉络见下节。

---

## 项目演进路线（脉络摘要）

> 供后续理解项目脉络；每项一行 = 目标 + 关键设计。详细契约以 `doc/api`、`doc/database`、`doc/ui` 各文档为准。

**阶段 A：地基**（T0-T7）——7 包 monorepo（shared → llm/db/tools → agent → server，client 只依赖 shared）；shared 纯类型/常量/纯函数（zod 仅服务端）；schema 演进（user_version 三态）；存储三文件原子写。

**切片 1-13**——项目管理/大纲（严格三层卷→章→场景）/实体（四类 + 通用关系表 `relation_records`）/回收站（软删级联）/Delta（独立表 + computeState 沿父链累积）/LLM 客户端 + 工具注册/会话成对裁剪/上下文分层注入/agent 三重保险（8 轮/120s/token）/提案仓仅内存 + 快照重校验/chat SSE（心跳 + 三路断开检测）/伏笔面板/节点结构化 data（麦基字段集）。

**阶段 U：UI 工作台重构**（U1-U8）——三栏 1:5:4（左书架/中信息条 + 7 tab/右 ChatPanel 常驻，可拖拽调宽 + 收起）；shadcn + oklch 文学氛围双主题；会话归属项目。

**画布 S10 → 批次八 O6 移除**——画布页删除（1000 章后无实际价值），`plot_edge` 数据/接口能力保留（仅无 UI 入口）。

**阶段 B/C/B2**——B1 项目提示词编辑（创作伴侣定位，不编辑/存储/读取正文）；C 时间轴（timepoint 实体 + occurs_at 挂载 + 双独立线性序 + SCHEMA_VERSION 3）；B2 自动备份与恢复（项目级频率/命名 kind 标记/重命名、project_id 唯一 key 覆盖分流、`.backups/` 保留 20 份）。

**用户反馈批次一至八（2026-08）**——F1-F9（字段清空语义/备份 WAL/时间轴视觉重构/三栏收放/标签建议/LLM 排序）；G1-G3（区块滚动/时间标签点实体化/滚动保持）；H1-H6（时间轴交互：删除入口/免确认/按钮展开/边框/右移/图标）；批次四 I1-I4（设定层级 = belongs_to）；批次五 J1-J3 + K1/K2（分类统一 data.tags，SCHEMA_VERSION 4）；批次六 M1-M3（标签编辑器）；批次七 N1-N2（上级设定递归子树筛选）；批次八 O1-O6（画布移除 + 可搜索下拉/大纲操作区/时间轴拖拽柄等）。

**发布与阻断项（2026-08）**——导出/导入（fflate zip 三文件 + 导入校验）、schema 安全（未来版本拒绝打开 / 增量迁移机制）、发布链路（6 包 npm + OIDC Trusted Publisher + CI 全绿）。发布管道坑记录见文末。

**批次九至十五（2026-08）**——llm 引擎换核（pi-ai 单向 adapter 防腐层）；参考资料第 7 实体类型（SCHEMA_VERSION 5）；大纲/时间轴交互优化（Enter 新建子级/双击详情/行内编辑/只留删除）；右键菜单替代行级问 AI；项目规则文件 AGENTS.md（唯一事实源 + prompt 自动迁移）；设定树形视图；参考资料两类承载（md 文件 = 真相源 + 外源链接）；分类自定义（自由文本 + datalist 聚合）；人物列表四列布局（状态列移除）；设定树手动排序（同级 sort_order + 复合 move 端点）；工具调用人类可读化（names/resolve 摘要渲染）；备份 1 分钟档；用户级配置 schema v1；db 查询层 drizzle-orm（61 处 prepare 清零，迁移/事务/JSON 防御语义不变）。

**批次十六（2026-09-05，v0.0.24）——多 provider 接入（OpenCode Go 订阅）**——llm 注册 pi-ai `opencode-go` provider（15 模型）；用户配置 schema v2（provider + api_keys）；每 provider 三级 key 链（env > config > pi-agent auth.json 只读）；设置页每提供商一卡 + 聊天下拉 optgroup 分组/无 key 组禁用；**模型解析绝不跨 provider**（撞名消歧防串 key）；OpenCode Zen（`opencode` provider）不接入（共享 env 防混淆）。契约见 endpoints.md §系统设置。

**文档体系重构（2026-08，v0.0.23）**——删除 `decisions.md`/`decisions-history.md`/`release-review.md`，详细设计四篇承接仍生效契约；全仓「决策 N」编号体系与注释中设计文档引用清除（代码注释只保留实现意图，文档增删不再牵连注释）；历史事实由 `git log`/CHANGELOG 回溯。

---

## 发布管道坑记录（供后续发布参考）

- npm 12 publish 在 postpack 恢复后生成 registry manifest → prepack 替换只影响 tarball（manifest 残留 `workspace:*`，`npm install` 报 EUNSUPPORTEDPROTOCOL）→ 发布前主动替换 + `--ignore-scripts`
- CI node 22 自带 npm 10.9.8 **不支持 OIDC 发布认证** → CI `npm install -g npm@latest`
- npm 12 发布自动生成 sigstore provenance，npmjs 校验 manifest `repository.url` 一致（E422）→ 各包补 `repository` 字段
- setup-node 注入占位 `NODE_AUTH_TOKEN` 优先于 OIDC → 发布前 `delete process.env.NODE_AUTH_TOKEN`
- registry 文档缓存传播延迟（dist-tags 即时、`npm view`/install 短暂 404/ETARGET）→ verify-installed 先 `npm view` 轮询 6 包可见（20×30s = 10 分钟窗口）再 install
- automation token（绕过 2FA）不能执行 unpublish/deprecate（npm 安全策略 403）→ 需 2FA 凭据或网页操作
