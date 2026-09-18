# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。验证命令见根 `AGENTS.md`。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**，本文件不维护批次叙事）；**未排期的遗留项与待验证项一律进 `backlog.md`**（等触发条件 / 产品决策未定 / 只能人工执行三类混排在那边）；新发现的小项也先进 `backlog.md`，不即时插队。

---

## 批 13：写作面（常显工具条 / 专注模式 / 写作偏好）

**批目标**：把「正文能写」推进到「正文好写」——常显工具条（不让用户猜命令）、专注模式、字体/字号/行高/纸张/纹理/段首缩进偏好、命令帮助、保存时间戳。**零后端改动**（不碰 server / api / db / tools / desktop）。契约：`docs/ui/DESIGN.md` §Colors「写作面偏好」+ §Components「写作面（工具条 / 专注模式）」+ §Layout「专注模式」+ §Typography（写作面字体例外）、仓根 `AGENTS.md`（写作面偏好条目）。

| 卡 | 内容 | 依赖 | 验收 |
| :-- | :-- | :-- | :-- |
| [x] 13.1 | **常显写作工具条（骨架）**：新建 `components/blocknote/editor-toolbar.tsx`，作为 `BlockNoteView` 的 `children` 渲染（已核实：children 在 `.bn-container` 内、**不在** contentEditable、拿得到 `ComponentsContext`）；左侧复用库按钮组件（`BlockTypeSelect` / 四种 `BasicTextStyleButton` / `ColorStyleButton` / `TextAlignButton`×3 / `NestBlockButton`+`UnnestBlockButton` / `CreateLinkButton`，**不要** File*/Comment* 那几个），右侧自绘撤销/重做（`editor.undo()/redo()`，**不做禁用态**）；`blocknote.css` 给 `.bn-container` 加 flex column + 工具条 `order:-1`、`sticky top-0`、高 40px、底 = 正文底、底部 1px `--bn-colors-border`、**去掉库自带阴影与白底** | — | 两页（`#/manuscript/:id`、参考资料详情编辑态）都出现工具条；按钮生效（改块类型/加粗/颜色/对齐/缩进）；撤销/重做可用；深浅两态像素核对；`pnpm typecheck`/`lint`/`@whispering233/ai-editor-client` test。**✅ `35840ee`（骨架）+ `a0f5ccc`（修复轮）**：oracle 静态审查 PASS（逐个指认装包 API 真实存在、children 落在 `.bn-container` 内且非 contentEditable、样式纪律零命中、回归面未动），但判 FAIL 一处：工具条自己既是 `sticky` 包含块又是滚动容器 ⇒ 库 tooltip 与 ariakit select·menu 被它自己裁掉（实测 tooltip 落在条外、块类型下拉只剩 18px）——修复轮改显式 `overflow: visible` + `flex-wrap` 折行。**主会话浏览器实测**（浅/深两态）：两页都有工具条（14 按钮）；tooltip hit-test 可见；块类型下拉 300px/15 项可见且**功能生效**（H3→二级标题，撤销还原）；颜色菜单 905px/20 项首末项均可见；浮动条仍在最上层（hit-test 命中浮动条）；窄/中栏宽 3 档下按钮越界数 = 0（窄幅折行增高 41→113px）；文字与字数未受影响。 |
| [ ] 13.2 | **写作偏好：字体 / 字号 / 行高**：新建 `hooks/use-writing-prefs.ts`（localStorage `ai-editor:writing` + 防御解析 + 档位收敛；**档位常量唯一定义处**，仿 `use-panels` 带纯函数单测）+ `components/blocknote/writing-settings.tsx`（工具条右侧「写作设置」下拉）+ `blocknote.css` 间接引用（`--writing-font` / `--writing-font-size` / `--writing-line-height`；行高覆盖库的 `.bn-block-outer{line-height}`）；测试断言档位与 `DESIGN.md` 同值 | 13.1 | 切字体/字号/行高即时生效、刷新后保持；恢复默认可用；深浅两态像素核对（宋/楷/仿宋栈 + 等宽）；单测覆盖「坏 JSON / 越界值 / 缺键」；`pnpm typecheck`/`lint`/client test |
| [ ] 13.3 | **写作偏好：纸张 + 段首缩进**：`index.css` 加 `--paper-cream` / `--paper-warm` 浅深两套值（口径同 `--tag-*`）+ `blocknote.css` 消费为 `--paper-bg` 与纹理 `background-image`（横线/网格，线色 = `--ant-color-border-secondary`，间距常量）；段首缩进 = 段落块 `text-indent: 2em`（`data-writing-indent`） | 13.2 | 3 档纸张 × 3 档纹理 × 缩进开关全部即时生效并持久化；深浅两态像素核对；取消勾选回到 `{colors.canvas}`；`pnpm typecheck`/`lint`/client test |
| [ ] 13.4 | **专注模式（仅章正文页）**：`stores/ui.ts` 加瞬态标志（**不持久化**）；`AppShell` 走简化布局（隐左栏 / 右栏 / `InfoBar`，不渲染拖拽手柄）；`Manuscript` 隐页头 + 工具条右端承载「字数 · 保存态 · 退出专注」+ `Esc` 退出；工具条「专注模式」按钮由页面 prop 注入（参考资料页不注入） | 13.1 | 进/出专注模式像素核对（浅深两态）+ `Esc` 退出 + 切章/刷新/409 冲突框/保存失败条均不受影响；退出后三栏与拖拽手柄恢复、`localStorage` 无新键；`pnpm typecheck`/`lint`/client test |
| [ ] 13.5 | **命令帮助弹窗**：`components/blocknote/command-help.tsx`（复用 `components/ui/dialog.tsx`）：`/` 斜杠菜单、块手柄、`Cmd/Ctrl+B/I/U`、`Cmd/Ctrl+Z`、`Tab`/`Shift+Tab`；工具条按钮打开 | 13.1 | 弹窗可见、`Esc` 关闭；条目与工具条按钮集一致（13.3 的纸张/缩进也列一条）；`pnpm typecheck`/`lint`/client test |
| [ ] 13.6 | **保存时间戳（微卡）**：`Manuscript` 页头「已保存 · HH:MM」（专注模式下同一处显示） | — | 保存后出现时间戳、重新保存刷新为最新；`pnpm typecheck`/`lint`/client test |

**依赖顺序**：13.1 → 13.2 → 13.3；13.4 / 13.5 依赖 13.1；13.6 独立。（13.4 与 13.6 都改 `pages/Manuscript.tsx`，不要并行。）

**批验收**：全部卡完成后跑 `pnpm -r build` + `pnpm typecheck` + `pnpm lint` + `pnpm -r test`，并由 **subAgent 做浏览器像素走查**（浅深两态 × 常规/专注 × 三档字体 × 纸张开关）；`CHANGELOG.md` Unreleased 条目 + `backlog.md`（只读模式、纹理对齐、剩余旋钮）/`tasks.md` 清卡。

## 卡的分工与验收

- **派工硬要求**（`AGENTS.md`「协作流程」）：子代理必须显式 `context: "fresh"`；每卡带硬完成判据（`git log` 含新 commit + `git status` 干净，无 commit 不许报 PASS）；汇报必附 commit hash 与命令输出。
- **验收命令**：见根 `AGENTS.md`「协作流程」的验证条（含单包测试 filter 口径、改上游 `src` 后先 build、改桌面主进程后的打包态冒烟）——此处不再重抄，避免两处漂移。
- **需要真 HTTP 上游的卡**：本地 WebDAV 服务（`rclone serve webdav <dir>: --addr 127.0.0.1:8080` 或 `wsgidav`）或自带最小假 DAV；单测一律 mock `fetch`，集成验证才起真服务。**凭据不进任何自动化脚本、不入库**。
- **发布**：见 `build.md`「正式发布链路」（CHANGELOG 搬运 → `pnpm release:version` → commit + annotated tag → push tag 触发 CI）；桌面版每版必须三资产齐全。
