# AGENTS.md

面向编码 agent 的协作入口。**设计文档是单一事实来源**——本文件只回答「读什么」与「怎么协作」，不重复文档内容。

## 文档即契约（阅读顺序）

`docs/design/00-master-design.md`（产品定位与设计原则）→ `architecture.md`（技术栈 + 分包与依赖方向）→ 详细设计（`10-data-model.md` → `20-context.md` → `30-agent-loop.md`，只讲「为什么 + 不变式」）→ 按职责读 `docs/api/`（先 `00-api-index.md` + `api-public.md`）与 `docs/db/schema.md`（字段/端点契约的「是什么」）→ 前端改动必读 `docs/ui/DESIGN.md`（**视觉与布局唯一契约**：颜色/字号/圆角/间距/三栏布局与中栏页头结构/组件外观；改样式先改它）。

- 任何改动前先读对应文档；发现文档之间或文档与代码矛盾，先停下提问，不要自行发明。
- 状态与演进：根 `CHANGELOG.md`（逐版本事实）+ `tasks.md`（当前任务卡）。
- 运行/构建/发布：`build.md`；配置载体与读写边界：`config.md`。

## 协作流程

- 任务以 `docs/design/tasks.md` 为清单：按卡开发，垂直切片、一次一张、一卡一 commit、独立验证、卡内不做卡外顺手改动；完成后清理卡片并向用户汇报。
- 每卡「实现 fixer/designer + 独立验证 oracle」双代理；并行卡片用临时分支 + git worktree，验证后合回 main 并清理。
- 验证：`pnpm typecheck` / `pnpm lint` / `pnpm -r test`（单包 `pnpm --filter <包> test`）；⚠ fresh clone 先 `pnpm -r build` 再 typecheck。
- 提交信息用中文，遵循 conventional commits（如 `feat(doc): ...`）。
- 日常不 push、不建 PR、不新增 CI；远端与 CI 仅服务发布链路（push `v*` tag 触发 `.github/workflows/`）。

## 版本发布

按 `docs/design/build.md`「正式发布链路」执行。

## 代码级硬约束（设计文档不承载实现细节，仅此处登记）

- `db` 查询层统一经 `queryDb` 取 drizzle 实例，**禁止绕过直接 `prepare`**（迁移管线除外）；JSON 列（data/changes/metadata）一律 text 模式 + 行映射防御解析，**禁用 drizzle `mode:'json'`**（坏 JSON 会打挂整表查询）。
- **对话历史唯一存储 = 项目目录 `sessions/<session_id>.jsonl`**（不再写 data.db）；`session_id` 必须过 `^sess_[A-Za-z0-9_-]{1,64}$`——它同时是文件名，**禁止拼接未校验的 id**（路径穿越）。写文件类迁移（`up(db, ctx)`）必须幂等（整文件重写），崩溃后重跑收敛。
- **项目目录内的「随包目录」（`references/`、`sessions/`）改动必须同步四处**：备份白名单、打包、变更判定（mtime）、恢复/导入的整体覆盖——漏一处就出现「备份丢数据」或「只聊天不触发自动备份」。
- `client` 聊天链路：POST `/chat` 的 SSE 解析唯一实现是 `hooks/use-sse.ts`（勿另起炉灶）；chat store 的 loadSeq/msgSeq 竞态与「中止在途 SSE」约定改动时必须保持。
- `client` 视觉：**颜色/选中面 token 只能改 `AntdProvider.tsx`**（唯一改色入口，并同步 `docs/ui/DESIGN.md` 登记表）；守卫 `design-discipline.test.ts`（源码扫描：`lucide-import` / `hardcoded-color` / `important-class` / `ad-hoc-font-size` / `primary-bg-token` / `dropdown-menu-selectable` / `antd-root-override` / `cssvar-scope` / `no-dynamic-class` / `button-variant-color`）与 `components/antd-tokens.test.ts`（派生 token 对比度）。**不变式：深墨主色（`#37352f`）下任何由 `colorPrimary` 派生的「浅底」token 都不可信**（antd 派生的是中深灰，2.26:1 不可读）——选中面已显式覆盖，新增 antd 组件（Tree/Table 行选、Cascader、DatePicker…）时先扩 token 守卫。antd Select 浮层默认跟随触发器宽度 ⇒ 窄触发器必须 `popupMatchSelectWidth={false}`。
- 仓库路径：`docs/`、`scripts/`、`test-project/` 在仓库根；包内路径相对 `packages/`。
- 测试：各包 `test` script = `vitest run`；各包 tsconfig 已 `exclude: ["src/**/*.test.ts"]`，不要改回。
- 延期项（MVP 不做，勿顺手实现）：多标签页并发、undo、token 统计、跨书参考资料导入。
