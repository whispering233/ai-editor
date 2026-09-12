# 系统设置

> LLM 配置读写（provider 目录 / 凭据状态 / 激活模型 / 思考强度）。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；配置载体与读写边界见 [`../design/config.md`](../design/config.md)。

**配置所有权在本仓之外**：模型目录、凭据、运行参数全部落 pi agent dir（`~/.pi/agent/` 的 `auth.json` / `models.json` / `settings.json`），本仓只提供设置页的读写端点，**不维护第二份配置**。凭据解析顺序（pi 0.85.1，`pi-ai` `auth/resolve.js` + `auth/helpers.js`）：**auth.json 存量凭据优先**（一家一条；值支持字面 key / `$ENV_VAR` 引用 / `!命令`）→ 无条目时才回落到 provider 内置环境变量（如 `DEEPSEEK_API_KEY`，状态记为 `source: "environment"`）——因此不存在「两套来源竞争」，环境变量只是兜底。

### GET /api/v1/settings/llm

读取 LLM 配置（provider 目录 + 认证状态 + 激活状态；凭据不回传明文）。

```typescript
// 激活模型解析：pi settings 的 defaultModel（provider+model 成对）；未配置 → 首个有凭据的可用模型；
// 一个可用模型都没有 → provider/model 均为空串（前端展示「未配置」引导）
// Res: 200
{
  provider: string;          // 当前激活 provider（来自 pi，缺省由 pi 解析）
  model: string;             // 当前模型 id
  thinkingLevel: string;     // "off"|"minimal"|"low"|"medium"|"high"|"xhigh"|"max"（缺省由 pi 决定）
  providers: [               // 全量 provider（含未配置认证的：设置页三级导航只列已配置 + 当前激活 + 刚点选的家，「添加」列表用未配置的家）
    {
      id: string;            // pi provider id（deepseek / opencode-go / anthropic / …）
      displayName: string;   // pi provider 名称
      authConfigured: boolean; // 该 provider 是否已有可用凭据（env / auth.json / runtime）
      authSource?: string;   // pi `AuthStatus.source`："stored" | "runtime" | "environment" | "fallback" | "models_json_key" | "models_json_command"（无凭据时不带该字段）
      models: [              // 该 provider 的模型目录（pi 静态目录 + 远端 overlay 结果）
        { id, provider, displayName, contextWindow, maxTokens, reasoning }
      ]
    }
  ]
}
// 聊天模型下拉按 authConfigured 过滤：未配置认证的 provider 整组不可选（当前激活组除外，防困死）
// 设置页三级导航同理：authConfigured ∪ 当前激活 ∪ 刚点选的家（provider-icon 取品牌 logo）
```

### PUT /api/v1/settings/llm

更新 LLM 配置（写入 pi 的 settings / credential store，**绝不写入项目文件**）。

```typescript
// Req
{
  provider?: string;                            // 激活 provider；配合 model 同传（跨 provider 切换语义）
  model?: string;                               // 模型 id；服务端校验 model ∈ provider 目录，不符 → 400 VALIDATION_ERROR
  thinking_level?: string;                      // 全局思考强度（写 pi settings）
  api_key?: { provider: string; key: string };  // 单家凭据（写 pi credential store）
}

// Res: 200
{ saved: true }

// api_key 语义：
//   key 非空 → 写入该 provider 的 API key 凭据（覆盖同名 api_key 条目）
//   key 为空字符串 → 删除该 provider 的存量凭据（回到 env 解析）
//   存量是 OAuth（订阅登录）时，**写入与删除都拒绝**（400 VALIDATION_ERROR）——用 pi CLI 管理订阅登录
//   凭据已落盘但模型状态同步失败 → 500 INTERNAL_ERROR
//   写入发生在服务端进程内（pi credential store 文件锁保证并发安全）
// 配置变更仅影响新请求；运行中的 agent 循环不受扰动
// 聊天模型解析：POST /api/v1/chat 使用当前激活模型（provider + model 成对校验，绝不跨 provider 串用）
```

### 不做的事

- **不提供 OAuth 登录流程**（pi 支持的订阅登录不在本仓 UI 范围）：需要订阅凭据的用户用 pi CLI 登录，本仓只读该凭据状态。
- **不提供自定义 provider 表单**：`~/.pi/agent/models.json` 由用户手工维护（pi 原生语义），本仓只展示其结果。
- **不提供重试/压缩参数 UI**：这些参数在 pi settings 里，直接编辑 `~/.pi/agent/settings.json`（见 `../design/config.md`）。
