# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

当前无进行中的任务卡。

## 已定序、未开工（R3 后续两刀，开工前各自再走一次设计提问）

- **`models.json` provider 表单**：baseUrl + api 形态 + 模型列表；必须同时落「注释检测（`stripJsonComments(text) !== text` 即禁用表单）/ 改写前备份 / 保存前最终文本预览」三件套 + 未知字段透传；字段源 = pi 自带 `schemas/models.schema.json`。
- **`settings.json` 开关子集**：`retry.enabled` / `compaction.enabled` / `httpIdleTimeoutMs`；走同一条文本端点（不用 pi typed setter——同样丢注释，且注释会让 `save()` 静默早退）。`enabledModels` 是模式串、`thinkingBudgets` / `httpProxy` 无 setter，一律留在 JSON。