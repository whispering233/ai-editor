# 系统设置

> 用户级 LLM 配置（schema v2）读写与各家 key 状态。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；接口索引见 [00-api-index.md](./00-api-index.md)。

### 用户级配置文件 `~/.ai-editor/config.json`（schema v2，多 provider）

用户级 LLM 配置存放于 `$HOME/.ai-editor/config.json`（HOME 可覆盖——测试隔离依赖），**绝不写入项目文件**。格式 schema 定义于 `@whispering233/ai-editor-shared/schemas`（`userConfigFileSchema`，服务端校验；client 只消费类型）。

```json
{
  "schema_version": 2,
  "provider": "deepseek",
  "model": "deepseek-v4-flash",
  "thinking_level": "high",
  "api_keys": {
    "deepseek": "sk-xxx",
    "opencode-go": "oc-xxx"
  }
}
```

| 字段 | 类型 | 说明 |
|------|------|------|
| `schema_version` | `2`（可选） | 格式版本；v0/v1 旧文件**读侧兼容不迁移不写回**（首次在设置页保存时自然落 v2）；未知字段保留不校验 |
| `provider` | string（可选） | 当前激活 provider，缺省 `deepseek`；取值 = provider 目录 id（deepseek / opencode-go） |
| `model` | string（可选） | 当前模型名，**属于 `provider` 目录**（缺省 `deepseek-v4-flash`；多 provider 模型名可撞名，靠 provider 消歧） |
| `thinking_level` | enum（可选） | 思考强度 `off/minimal/low/medium/high/xhigh/max`，缺省 `high`（全局，不分 provider） |
| `api_keys` | map（可选） | 各 provider 的 API key（不入项目文件）；v1 旧 `api_key` 字段读侧视为 `api_keys["deepseek"]` |
| `context_budget` | object（可选） | 上下文预算：`history_ratio`（历史层 = 激活模型 `contextWindow` × ratio，缺省 `0.15`）、`tool_result_max_tokens`（单条工具结果上限，缺省 `8000`）；字段缺失/类型不符/整段非法 → 全部回落缺省（宽松读取，不报错、不写回）。设置页不做 UI，直接编辑文件 |

**每 provider key 解析链**（读侧，不入项目文件）：

| 顺序 | 来源 | 说明 |
|------|------|------|
| 1 | 环境变量 | deepseek → `DEEPSEEK_API_KEY`；opencode-go → `OPENCODE_API_KEY` |
| 2 | `~/.ai-editor/config.json` `api_keys[<provider>]` | 设置页写入；v1 旧 `api_key` 字段仅对 deepseek 生效（等价 2 级） |
| 3 | pi-agent 配置 `~/.pi/agent/auth.json`（只读兜底） | 读 `[<provider>]` 项，`type === "api_key"` 且 key 非空才生效；文件不存在/非法/无该项 → 跳过。仅读取，**绝不写回** |

文件不存在 / JSON 损坏 / schema 不合法 → 按空配置读取（默认值语义，不抛错）；**不主动改写用户文件**。

### GET /api/v1/settings/llm

读取 LLM 配置（设置页各家 key 状态 + 模型目录 + 激活状态；key 不回传明文）。

```typescript
// Res: 200
{
  provider: string;          // 当前激活 provider（缺省 "deepseek"）
  model: string;             // 当前模型名（属于 provider 目录，缺省 "deepseek-v4-flash"）
  thinkingLevel: string;     // "off"|"minimal"|...|"max"（缺省 "high"）
  providers: [               // 全量 provider（目录 + 各家有效 key 状态）
    {
      id: string;            // "deepseek" | "opencode-go"
      displayName: string;
      apiKeySet: boolean;    // 该家解析链（env > config > pi-agent auth）上是否存在有效 key
      apiKeyMasked?: string; // 掩码展示，如 "sk-****1234"
      models: [              // 该家模型目录（llm getAvailableModels(provider)）
        { id, provider, displayName, contextWindow, maxTokens, reasoning }
      ];
    }
  ]
}
// key 解析链按 provider 独立判定；聊天下拉据此禁用未配 key 的整组模型
```

### PUT /api/v1/settings/llm

更新 LLM 配置（写入用户级配置文件 `~/.ai-editor/config.json`，**绝不写入项目文件**）。

```typescript
// Req
{
  provider?: string;                            // 激活 provider；配合 model 同传（跨 provider 切换语义）
  model?: string;                               // 当前模型名；服务端校验 model ∈ provider 目录，不符 → 400 VALIDATION_ERROR
  thinking_level?: string;                      // 思考强度（全局）
  api_keys?: { [provider: string]: string };    // 各家 key（写谁谁变）；空字符串 = 清除该家已保存 key
}

// Res: 200
{
  saved: true;
}
// 配置变更仅影响新请求；运行中的 agent 循环不受扰动
// 聊天模型解析：POST /api/v1/chat 按 config.provider + config.model 一对查模型目录（同 provider 内兜底，绝不跨 provider——防撞名模型串 key）
```
