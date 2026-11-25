# 开发任务清单（Task Cards）

只放当前 / 进行中的任务卡，完成后清卡（历史 = `CHANGELOG.md` 的逐版本段）；未排期项进 `backlog.md`。执行纪律与派工流程见 `AGENTS.md`「协作流程」。

契约已先行登记（实现阶段不得再改契约；发现文档与代码冲突就停下提问）：

- `docs/ui/DESIGN.md` `tab-advanced`（五张卡顺序 + `runtime-params` 形态）
- `docs/api/90-api-settings.md`（pi 配置文件对 `models.json` 与 `settings.json` 提供表单；本卡只写三键、浅合并、严格 JSON 不做注释确认）
- `docs/design/config.md`（`settings.json` 的读写方）
- `AGENTS.md`（升级 pi 后复查：模型 / 运行参数表单字段源 = `schemas/{models,settings}.schema.json`）

## 卡 4 · 高级 → 运行参数（三个键）

**改动面**

1. 新增 `packages/client/src/lib/runtime-params.ts`（纯函数）：
   - `readRuntimeParams(text)`：严格 `JSON.parse`（空文本 / 空对象 = 三项皆缺省）；返回 `retryEnabled` / `compactionEnabled`（`boolean | undefined`）、`httpIdleTimeoutMs`（`number | undefined`）与原始对象；坏 JSON / 顶层非对象 / 字段类型不符 → 可读 reason。
   - `composeSettingsText(original, params)`：**浅合并**——`retry` / `compaction` 只改 `enabled`（`undefined` = 删键），其它字段原样保留；`httpIdleTimeoutMs` 写值或删键；顶层未知键透传；`JSON.stringify(..., null, 2)`。
   - 校验：`httpIdleTimeoutMs` 正整数、下界与单位以 pi `schemas/settings.schema.json` + `SettingsManager` getter 为准（**先读实际 schema，不许凭记忆**）；空 = 缺省。
2. 新增 `packages/client/src/components/settings/runtime-params-panel.tsx`：形态严格按 `DESIGN.md` `runtime-params`——`SectionCard` + 「保存」（`dirty && !saving`）+ `icon-button`「重新读取」+ 两个 `Select`（默认 / 启用 / 关闭）+ `InputNumber`（ms，空 = 默认）+ `caption-text`；加载 / 解析失败 → 行内错误 + 控件禁用 + 指路下方「本机配置文件 → 运行参数」。
3. `components/settings/pi-config-section.tsx`：五卡顺序 = `PiDirPanel` → `SearchKeyPanel` → `ModelsProvidersPanel` → `RuntimeParamsPanel` → `ConfigFileEditor`；`lib/config-files.ts` 的 `settings.json` 提示补一句「表单在上方『运行参数』卡，这里只写其余字段」。
4. 测试：`lib/runtime-params.test.ts`（空文本 / 坏 JSON / 类型不符 / 浅合并保住 `maxRetries` 等 / 「默认」删键 / 数字边界与非法值 / 未知键透传）+ 面板 SSR 走查（加载中、就绪、解析失败禁用、dirty 与保存按钮态）。

**验收判据（硬）**

- `git log` 含本卡新 commit + `git status --short` 干净（无 commit = 不许报 PASS）。
- `pnpm typecheck` / `pnpm lint` / `pnpm --filter @whispering233/ai-editor-client test` 通过。
- 浏览器走查（**沙箱 HOME**，不得写真实 `~/.ai-editor`；最多 3 张截图）：① 预置含 `retry.maxRetries` + 未知键的 `settings.json` → 卡片显示三项当前值；② 重试改「关闭」保存 → 文件里 `retry.enabled=false`、`maxRetries` 与未知键仍在；③ 改回「默认」保存 → `enabled` 键被删除；④ 空闲超时设合法值保存成功、负值被拦下并给行内错误；⑤ 顺序 = 五张卡（pi 目录 → 联网搜索 → 自定义模型 → 运行参数 → 本机配置文件）。
- 汇报附 commit hash + 命令输出 + 走查结论。
