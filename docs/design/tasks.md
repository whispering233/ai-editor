# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### R1 大纲层级徽标双色（卷红褐 / 章·场软灰）

- **目标**：卷 = 现有红褐 `type-badge-border`；章 / 场 = 新增 `type-badge-border-soft`；同一枚「章」全站一色。
- **改动**：
  - `index.css`：新增 `--type-badge-border-soft`（浅 `#787671` / 深 `rgba(255,255,255,.51)`）与 Tailwind 映射 `--color-type-badge-border-soft`。
  - `components/ui/tag-chip.tsx`：新增 `tone?: "default" | "soft"`，默认不变；`soft` 只换边框类。
  - 调用点：`pages/Outline.tsx`（树行 + 就地新建行，卷 default、章/场 soft）、`components/writing/chapter-rail.tsx`（卷 default、章 soft）、`pages/OutlineDetail.tsx:295`（卷 default、章/场 soft）、`pages/Trash.tsx` 的 `TypeBadge`（实体 default；节点卷 default、章/场 soft）。
  - `components/ui/tag-chip.test.tsx`：补 `tone="soft"` 断言，默认红褐不变。
- **边界**：不改 `docs/`；`阅读进度` / `推演节点` 状态徽标与其它枚举 `TypeChip` 保持默认红；不新增第三种彩色。
- **验收**：`pnpm typecheck`、`pnpm lint`、`pnpm --filter @whispering233/ai-editor-client test`；浏览器浅 / 深色各看大纲树、写作页卷章栏、节点详情、回收站节点栏；软灰边框在两态均可见，卷仍红褐。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
