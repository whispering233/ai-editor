# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡。完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

## 当前任务卡

> 执行顺序：卡 1 已完成并验证；执行卡 2，独立验证并 commit；B1（md zip 根级章顺序）在卡 2 完成后从 `backlog.md` 单独开卡。

### 卡 2：单章 TXT 导出（写作页）

**目标**：写作页章正文页头「导出」下拉新增两项：`导出纯文本（保真）` / `导出纯文本（网文排版）`，只导出当前章，纯客户端、无端点。

**契约**（详见 `docs/api/110-api-manuscript.md` §导入导出、`docs/ui/DESIGN.md` §`writing-page`）：
- 正文取编辑器最新块 JSON（`latestRef`，含未保存改动）→ shared `blocksToPlainMd` → shared `buildNovelTxt`；不读服务端。
- 第一行 `第M章 章名`：章名空 → `第M章`；编号取不到 → 只用章名；都空 → `正文`。
- 文件名 `{章名}.txt` / `{章名}-网文.txt`（章名空 → `正文`；不带章号）；UTF-8 无 BOM + CRLF；空章只出标题行。
- 不弹确认框；成功 toast 文件名；失败 toast 错误。

**改动范围**：
1. `packages/shared/src/utils/novel-export.ts`：复用整本 TXT 的 `buildNovelTxt` / `novelTxtFileName`；不重复实现排版。
2. `packages/client/src/lib/document-io.ts`：`exportDocumentTxt(content, title, chapterLabel, layout)`——解析块 JSON（失败 → 空文本，不抛）→ `blocksToPlainMd` → `buildNovelTxt([{ kind: "chapter", label: chapterLabel, text }], layout)`；文件名 `novelTxtFileName(title, layout)`。
3. `packages/client/src/components/manuscript/chapter-editor.tsx`：从 `outline` 用 `numberOutline(outline).labels.get(chapterId)` 取章号；TXT 文件名基名 = `chapterTitle?.trim() || "正文"`（不改现有 JSON/MD 的 `documentTitle()` 行为）；显示标签按「`第M章 章名` → 章名空只留 `第M章` → 编号取不到只用章名 → 都空 `正文`」回退；下拉加两项；TXT 两项不 confirm，直接 `downloadTextFile` + toast。
4. 测试：`packages/client/src/lib/document-io.test.ts`（标题回退 / 两种排版 / 空内容 / 文件名 / 非法 JSON 不抛）；`chapter-editor` 现有无组件测试（仓内无 jsdom），至少加源码扫描断言（菜单含两项、TXT 不 confirm），或补 `document-io` 单测覆盖排版；不引 jsdom。
5. `CHANGELOG.md` `### Added` 补单章 TXT 一条（可与整本 TXT 同版本，但分卡分 commit）。

**硬完成判据**：同整本 TXT 卡（新 commit + `git status` 干净 + 汇报 hash 与命令输出）；不得改服务端 / API / 整本弹窗。
