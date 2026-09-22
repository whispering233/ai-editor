# 上下文与提示词详细设计

> **本文档职责**：回答「提示词分几层、项目规则从哪来、上下文预算归谁管、占用条与会话用量口径是什么」——注入分层、压缩与截断、AGENTS.md 通道的约束与理由。
> 端点契约见 `docs/api/10-api-project.md`（AGENTS.md 读写）与 `docs/api/80-api-chat.md`（SSE）；循环语义见 `30-agent-loop.md`。

## 1. 提示词三层注入

最终 system prompt = 三层拼接，**编辑者与持久化各不相同，注入逻辑保持分层，不搞双通道漂移**：

| 层 | 编辑者 | 持久化 | 注入方式 |
| :--- | :--- | :--- | :--- |
| 内核提示词 | 开发者 | 代码固定（agent 包常量） | pi resource loader 的 `systemPrompt` → 作为 `customPrompt` 主体 |
| 项目设定 | 用户 | 项目目录 **AGENTS.md（唯一持久化通道）** | pi 的 `<project_context>` / `<project_instructions path="...">` 段（数据源被显式覆盖为**仅项目根 AGENTS.md**） |
| 临时指令 | 用户 | 不持久化 | 聊天框消息（不单独设字段） |

**不变式**：

- 项目设定只有 AGENTS.md 一个通道（`project.json` 的 `prompt` 字段已废弃，见 §4）。
- **不做祖先目录与全局搜索**：pi 默认会向上遍历父目录的 AGENTS.md 并读取 `~/.pi/agent/AGENTS.md`；本仓用 `agentsFilesOverride` 把数据源替换为「项目根 AGENTS.md 唯一文件」，避免把创作根之外的规则悄悄注进对话。
- **不启用** pi 的技能（skills）与提示词模板：本项目工具集固定，技能清单只会增加不可见的状态来源。

## 2. 上下文分层与预算

不把整个世界塞进 prompt。分层如下，**预算与裁剪归 pi 管**：

| 层 | 内容 | 预算与超限行为 |
| :--- | :--- | :--- |
| 系统指令 | 内核提示词 + 项目设定 | 固定预算；超限仅记录不裁剪（用户内容不可裁） |
| 对话历史 | 由 pi 自动压缩管理（阈值 + 溢出两种触发） | 压缩参数归 pi settings（`reserveTokens` / `keepRecentTokens`）；压缩摘要 + 保留最近轮次作为新上下文起点 |
| 工具结果 | AI 按需拉取（工具调用） | 单条上限 = `TOOL_RESULT_MAX_TOKENS`（agent 包常量）；超限截断 + 结构化提示，**不终止对话** |
| 聚焦上下文 | 请求携带的 focus（当前视图实体/节点） | 由前端决定注入内容，作为本轮消息的一部分；不做单独预算 |

**不变式**：

- **估算口径归 pi**：token 估算（分级字符启发式）与「最近一次真实 usage 为基线、其后消息按估算补齐」的策略由 pi 实现；本仓不再自建估算器与滑动窗口裁剪。
- **压缩落盘**：压缩摘要作为会话文件的 compaction entry 持久化，恢复时按「摘要 + 保留起点」重建——压缩结果可审计、可回溯。
- **截断必须显式告知**：工具结果截断时返回内容注明「已截断 + 提示缩小范围」；静默截断会让模型基于残缺数据继续推理。
- **正文只读、按需拉取（2026-09）**：聚焦章时只注入「章标题 + 摘要 + 正文前 `FOCUS_CHAPTER_EXCERPT_CHARS` 字符（显式标注「节选」）」，完整正文由模型调只读工具按 `offset`/`max_chars`（缺省 `DEFAULT_CHAPTER_TEXT_CHARS`、上限 `MAX_CHAPTER_TEXT_CHARS`）分页拉取，截断时告知续读起点。**不做整章自动入上下文、不做全书正文预载**——正文预算与对话历史共享同一个上下文窗口，预载会挤掉推理空间。
- **占用条口径**：前端占用段数据 = pi `getContextUsage()`（`percent` / `tokens` / `contextWindow`），随 `turn_end` / `agent_end` 帧下发；**不再是「历史预算 + 各层之和」的自算分母**（旧口径下 1M 窗口占比永远是假指标）。**`tokens` / `percent` 可为 `null`**（压缩后到下一次模型响应之间占用未知）：帧照发，UI 渲染为 `? · 窗口` ——「未知」与「空」必须可区分。账目类指标（累计 tokens / 缓存 / 成本 / 速度）的口径见 §2.1。

## 2.1 会话用量观测口径（状态栏）

状态栏（`docs/ui/DESIGN.md` `session-status-bar`）的数字**全部由服务端算好下发**：

- **服务端唯一实现点**：累计用量 = agent 包 `sessionUsage(entries)`（口径 = pi `AgentSession.getSessionStats()`：assistant 消息 + `toolResult.usage` + `compaction` / `branch_summary` 的 usage 三类累加），命中率与订阅布尔同在此处算；速度 = agent 包 `createSpeedMeter()`。**客户端不累加、不计时、不复算分母**（UI 只做格式化与优先级隐藏）。
- **下发面**：`turn_end` / `agent_end` 帧带 `usage`；assistant 的 `message_end` 帧带 `speed`；`GET /chat/sessions/:id/messages` 带 `usage`（形状见 `docs/api/80-api-chat.md` §会话用量字段）。
- **命中率 = `cacheRead / (input + cacheRead + cacheWrite)`**：会话累计口径（不是「最近一条」），分母为 0 时省略该字段而**不是**报 0%。
- **成本是账目不是账单**：pi 按模型目录价格累加；模型无价格配置 → 恒 0（UI 隐藏该项）；订阅凭据（OAuth / `kimi-coding`）→ 数值仅为估算，UI 标「订阅 · 估算」；订阅判定用**末条 assistant 消息的 provider**（历史会话中途换过模型也按当时那家算，不用「当前设置里的模型」）。
- **速度 = 解码速度**：首个流式增量 → `message_end`；区间起点**刻意避开首字延迟与排队**（否则同一模型的速度会随网络抖动）；分子 = 该条消息的 `usage.output`（含思考 token）。守卫（任一命中即不下发）：无增量到达（非流式回退）/ `output <= 0` / 时长小于最小时长常量 / `stopReason` 为 `error` · `aborted`。**只报最近一轮**：不做实时估算（需自建 chars→token 估算 = 第二套口径）、不做会话平均。
- **历史会话只回账目，不回占用百分比**：pi 的 `getContextUsage()` 建在 `estimateContextTokens(当前上下文消息)` 上，而该函数**未导出** ⇒ 历史重建等于复刻一套估算口径，故不做。历史会话的占用段按「窗口已知 / 占用未知」渲染（`? · 窗口`，窗口取出当前激活模型目录）；速度同理无值（时序不落盘）。

## 3. 提示词落点

- 内核提示词是**产品定位的代码化**（「AI 是创作顾问不是代笔」、只基于结构化数据提建议、不生成正文；**正文与参考资料可读、但绝不改写**——写入工具在工具面上根本不存在）——改它等于改产品行为，需随 `00-master-design.md` 一起评审。
- 领域工具的说明（每个工具的用途、参数语义）随工具定义走（TypeBox schema 的 `description`），不写进系统提示词——一处定义一处维护。
- 项目设定（AGENTS.md）**不参与工具选择**：工具集固定，AGENTS.md 只影响分析口径与语言。

## 4. 项目规则文件 AGENTS.md

项目目录 **AGENTS.md** 是**唯一**持久化上下文通道，取代原 project.json `prompt` 字段：

- **自动迁移**：打开项目时若 `prompt` 存在且无 AGENTS.md → 自动迁移写入 AGENTS.md（内容原样，一次迁移后 prompt 不再使用；幂等，失败不阻塞打开、下次重试）。
- **注入**：system prompt 的项目设定段数据源 = AGENTS.md 文件内容（pi `<project_instructions>` 包装）。
- **编辑通道**：设置页直编（GET/PUT `/project/agents`，原子写）+ 用户可在文件管理器中直接编辑（web 读取 mtime 检测外部修改，提示刷新/重新加载）。
- **为什么**：AGENTS.md 是社区广泛接受的「项目规则」惯例，可见、可版本化；prompt 字段藏于 project.json 不可见不可控。
