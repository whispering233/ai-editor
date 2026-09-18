# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 批 12：块文档（章正文 + 参考资料）与 BlockNote

**批目标**：正文进系统（章级块文档）、参考资料正文同款化、编辑器换成 BlockNote；AI 对正文**只读 + 只建议**（无写工具）。语义与不变式见 `10-data-model.md` §13、`docs/db/schema.md`「document_records」、`docs/api/110-api-manuscript.md`、`docs/api/tool-calling.md`。

| 卡 | 内容 | 依赖 | 验收 |
| :-- | :-- | :-- | :-- |
| [x] 12.1 | **文档与契约更新**（无代码）：`00-master-design`（正文边界）、`10-data-model`（§1/§6/§11/§13）、`20-context`（§2/§3）、`40-cloud-sync`（并集组）、`architecture`（块编辑器依赖）、`backlog`、`docs/api/110-api-manuscript.md`（新）、`00-api-index`、`30-api-entity`（参考资料段 + 删 scan）、`20-api-backup`、`100-api-cloud`、`error-code`、`60-api-outline`（`metadata.textLength`）、`tool-calling`、`docs/db/schema.md`、`docs/ui/DESIGN.md`、根 `AGENTS.md` | — | 交叉引用自洽（grep 无 `references/` 残留口径） |
| [x] 12.2 | **db 底座**：`document_records` 表 + drizzle 声明 + 迁移 `008_document_records.ts`（纯 DDL）+ `SCHEMA_VERSION = 8` + 文档 helper（`getDocument` / `upsertDocument` / `deleteDocumentsByOwner`，含 `updated_at` 版本戳读回） | 12.1 | ✅ `2bf50f3`（oracle PASS） |
| [x] 12.3 | **shared 纯函数**：`isBlockArray`（浅校验）+ `blocksToPlainMd`（容错 walker：标题/列表/任务/引用/代码/表格/图/分隔/嵌套；未知块跳过；整体 try/catch 兜底不抛） | 12.1 | ✅ `f09de88`（oracle PASS） |
| [x] 12.4 | **服务端章正文端点**：`GET/PUT /api/v1/manuscript/:chapterNodeId`（章校验、`DOCUMENT_STALE` 409、派生 `content_text`、浅校验 400）+ `GET /outline?with_metadata=true` 增章 `metadata.textLength` + purge 级联删文档行 + shared api schema | 12.2 12.3 | ✅ `756e266`（oracle PASS：真 HTTP 逐条对契约 + 1MB/5000 层嵌套对抗 + purge 生命周期直查 SQLite） |
| [x] 12.11 | **`collectSubtreeIds` 真子树修复**（卡外行为修正，追加卡）：函数语义定死为「目标 + 全部后代，祖先不入集」，三处调用点（DELETE 级联 / restore 级联 / purge 级联）统一；补「删卷命中后代 / 删场景不越界 / restore 对称」断言 | 12.1 | ✅ `5e1cb29`（oracle PASS） |
| [x] 12.5 | **客户端正文页**：路由 `#/manuscript/:chapterId` + 入口（大纲页章视图行、`#/outline/:ch-*` 详情页「写正文」）+ `components/blocknote/` 封装（ariakit 变体）+ `blocknote.css` token 映射（浅/深）+ 自动保存（debounce + 离开 flush + 失败可见）+ 409 冲突弹窗 + 404 态 + 上/下一章 + 大纲/章视图字数展示 | 12.4 | ✅ `02d66be` + 修复轮 `b520eff`（空正文 `initialContent` 崩溃，浏览器走查发现）；**主会话浏览器走查 7/7 取证**：入口导航 / 可编辑 / 自动保存（页头「N 字 已保存」+ `PUT /api/v1/manuscript` 200）/ 刷新持久 / 两标签页冲突框与「覆盖保存」回写 / 章视图字数 / 浅+深两态计算样式均随 antd 变量 |
| [x] 12.12 | **块编辑器中文化**（浏览器走查发现）：`useCreateBlockNote` 传 `dictionary: zh`（`@blocknote/core/locales`），否则 placeholder / 斜杠菜单 / 工具栏均为英文（与「语言: zh」不一致） | 12.5 | 单测 + 浏览器复看 placeholder = 「输入 '/' 以使用命令」 | ✅ `71eb14b`（oracle PASS：含「zh 相对 en 仅缺 3 个搜索别名、无 UI 文案缺口」的反事实清单）；浏览器复看空章 placeholder = 「输入 '/' 以使用命令」 |
| [x] 12.6 | **导入导出通用件 + 正文入口**：导出块 JSON（无损）/ markdown（**先提示有损**）；导入 JSON（浅校验）/ markdown（解析后与原文比对，**无法导入的结构必须提示 + 确认**）；`<input type=file>` + `<a download>`（不加 preload 能力） | 12.5 | 往返验证：JSON 导出→导入一致；含颜色/对齐文档导出 md → 提示出现；含不支持结构的 md 导入 → 确认框出现 | ✅ `5df1bab`（oracle PASS）；**浏览器走查 6/6 取证**：导出 JSON 文件名 `提取词条.json` 且内容与编辑器一致 / md 导出先弹有损确认、确认后得 md 文本 / 有损 md 导入弹「含 1 处编辑器不支持的结构」且取消后内容不变 / 合法 JSON 导入后内容被替换、落盘、刷新后仍在 |
| [ ] 12.7a | **服务端参考资料装载拆分**：`data.content` → `document_records`（单事务）；详情 join 回 `content`；列表摘要改读 `content_text`；purge 级联删行；reference data schema 瘦身 | 12.2 12.3 | 写一篇 → 直查 SQLite（`entities.data` 无 content、文档行有且投影正确）；列表 `content` 摘要来自投影；purge 后文档行消失 |
| [ ] 12.7b | **文件机制退役（服务端/打包/云）**：删 `reference-files.ts` + `routes/reference.ts` + entity 路由写文件特例 + `trash.ts` file 分支 + backup `references/**`（白名单/打包/变更判定）+ cloud 并集前缀（只留 `sessions/`）+ shared `reference-file.ts`（frontmatter/sanitize）+ `REFERENCE_FILE_MISSING` | 12.7a | 全量测试；造项目确认备份 zip 条目 = 三文件 + `sessions/**`；本地 `test-project` 旧 `references/` 与旧 reference 行清理（人工，不入库） |
| [ ] 12.8 | **客户端参考资料**：编辑器换 BlockNote + 自动保存；列表页去掉「未同步」提示条与扫描按钮；草稿双路由（`new/md` / `new/link`）收敛为单一入口；「导入 md 新建」；详情页导出；移除 `@uiw/react-md-editor` 依赖与样式引用 | 12.7b 12.6 | UI 走查（编辑/保存/刷新一致、md 新建、旧草稿 hash 重定向、导出提示）+ 全量测试 |
| [ ] 12.9 | **AI 只读面**：工具 `get_chapter_text`（offset/max_chars/truncated）+ `get_entity('reference')` 返回投影文本 + focus 注入（章：标题 + 摘要 + 前 2000 字节选）+ 内核提示词（可读正文、绝不改写）+ 工具常量与 `constants.test.ts` 计数 + `propose_create_reference` 参数（纯文本 → 段落块） | 12.2 12.3 12.7a | 工具单测（分页 / 截断 / 非章报错）；真实对话验证「能读章正文、工具集无写入口」 |
| [ ] 12.10 | **收尾**：全量 `build` / `typecheck` / `lint` / `-r test` + 桌面打包态启动冒烟（客户端新增重依赖）+ `CHANGELOG.md` Unreleased 条目 + `backlog.md`/`tasks.md` 清理 | 全部 | 命令输出 + 冒烟记录 |

**并行可能**：12.2/12.3 完成后，正文轨道（12.4→12.5→12.6）与参考资料轨道（12.7a→12.7b→12.8）文件基本不相交，可用 worktree 并行；12.6 的导入导出通用件是 12.8 的前置。

---

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：`pnpm -r build`（改 `shared`/`db`/`tools` 的 `src` 后**必须先**跑，否则下游读 dist 出假绿）/ `pnpm typecheck` / `pnpm lint` / `pnpm -r test`；**改桌面版主进程后额外跑打包态启动冒烟**（`build.md`，`typecheck` 绿 ≠ 打包态能起）。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
