# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

当前无进行中的任务卡。

## 已定序、未开工（R3 最后一刀，开工前先确认是否值得单开一卡）

- **`settings.json` 开关子集**：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`；走同一条文本端点（`PUT /settings/config-file/settings.json`，不用 pi typed setter——同样丢注释，且注释会让 `save()` 静默早退）。`enabledModels` 是模式串、`thinkingBudgets` / `httpProxy` 无 setter，一律留在 JSON。**注意**：`settings.json` 是严格 JSON（不接受注释），所以表单不需要注释丢失确认；但用户手写的内容会被 `parse → stringify` 重排格式，卡片需在文案里说明。
