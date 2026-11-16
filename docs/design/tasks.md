# 开发任务清单（Task Cards）

垂直切片组织的开发任务卡。契约依据：`docs/design/`、`docs/api/`、`docs/db/schema.md`、`docs/ui/DESIGN.md`（改样式先改它）。

**执行纪律**：一次一张卡、一卡一 commit（回滚 = revert 该 commit）、验证通过才算完成；卡内不做卡外顺手改动；每卡「实现 fixer + 独立验证 oracle」双代理；发现文档与代码矛盾先停下提问，不要自行发明。

**本文件只放当前 / 进行中的任务卡**：完成的卡在此清掉（**历史 = 根 `CHANGELOG.md` 的逐版本段**）；**未排期的遗留项与待验证项一律进 `backlog.md`**，新发现的小项也先进那里，不即时插队。

---

## 当前任务卡

### T2 关联总览端点类型按源/目标分别筛选

- **目标**：`#/relations` 关联总览的端点类型筛选从「源或目标任一匹配（OR）」改为**源类型 / 目标类型两个独立下拉（AND）**，可表达「源 = 人物且目标 = 地点」。契约已更新 = `docs/ui/DESIGN.md` §Components `relations-view` 的筛选行。
- **改动**：
  - `packages/client/src/components/entity/relations-view.tsx`：
    - `RelationFilter.endpointType` 拆为 `sourceType` / `targetType`；`EMPTY_RELATION_FILTER` 同步。
    - `filterRelations` 分别判断两端（空串 = 不限；两端同时给 = AND）；名称搜索与关系类型过滤语义不变。
    - 控件行：把原「全部端点类型」下拉换成**源类型 / 目标类型**两个 `Select`，共用 `ENDPOINT_TYPE_LABEL` 派生的选项常量；两个下拉 `prefix` 常显「源」/「目标」，placeholder「全部类型」，`aria-label` 分别为「源端点类型过滤」/「目标端点类型过滤」，`minWidth: 140`，保留现有 `flex-wrap`。
    - 文件头注释改为「源/目标分别过滤」，不再声称 OR 是既定语义。
  - `packages/client/src/components/entity/relations-view.test.ts`：删除「任一端 OR」用例；新增只筛源、只筛目标、双端 AND、`sourceType=hook` 不命中「章 → hook」；原多条件 AND 用例按新语义调整。
- **边界**：不改 `docs/`（主会话已更新；发现矛盾先停下报告）；不补 `popupMatchSelectWidth={false}`（backlog 独立项）；不改名称搜索「源/目标名任一命中」；不改 `scope` 模式 / 人物页关系 tab / 节点详情关联区；不动 server / db / api / shared。
- **验收**：`pnpm --filter @whispering233/ai-editor-client test`、`pnpm typecheck`、`pnpm lint`；浏览器核 `#/relations`：源类型 = 人物、目标类型 = 地点、双端 AND、清空过滤回全量、窄宽折行；独立 oracle 复核。
- **硬完成判据**：`git log -1` 必须是本卡新 commit；`git status --short` 为空；汇报附 commit hash、命令输出与证据路径。无 commit 不许报 PASS。

---

派工与验收命令、发布链路见 `AGENTS.md`「协作流程」与 `build.md`；需要真 HTTP 上游的卡用本地 WebDAV 或最小假 DAV（单测一律 mock `fetch`），**凭据不入库**；测试端口前提见 `build.md`「本地开发」最后一条。
