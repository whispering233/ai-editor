# 系统设置

> LLM 配置读写（provider 目录 / 凭据状态 / 激活模型 / 思考强度）。公共约定/命名/响应结构见 [api-public.md](./api-public.md)，错误码见 [error-code.md](./error-code.md)；
> 请求/响应 schema 单一来源：`@whispering233/ai-editor-shared` `types/api.ts`；配置载体与读写边界见 [`../design/config.md`](../design/config.md)。

**配置所有权在本仓之外**：模型目录、凭据、运行参数全部落 **pi 配置目录**（缺省 `~/.ai-editor/pi-agent/` 的 `auth.json` / `models.json` / `settings.json`；目录可在「设置 → 高级」更改，与用户自己的 pi CLI 目录 `~/.pi/agent` 隔离），本仓只提供设置页的读写端点，**不维护第二份配置**。搜索 / 抓取的凭据是**另一份**（`~/.ai-editor/search.json`，见文末「本机配置文件」），不复用模型凭据。凭据解析顺序（`pi-ai` `auth/resolve.js` + `auth/helpers.js`）：**auth.json 存量凭据优先**（一家一条；值支持字面 key / `$ENV_VAR` 引用 / `!命令`）→ 无条目时才回落到 provider 内置环境变量（如 `DEEPSEEK_API_KEY`，状态记为 `source: "environment"`）——因此不存在「两套来源竞争」，环境变量只是兜底。

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

### GET /api/v1/settings/pi/dir

读取 pi 配置目录（生效值 + 缺省值）。生效值只来自 `~/.ai-editor/pi.json` 的 `agentDir`；键缺失 / 空串 → 缺省 `~/.ai-editor/pi-agent`。

```typescript
// Res: 200
{
  dir: string;        // 生效目录（绝对路径）
  defaultDir: string; // 缺省目录（前端「恢复默认」直接 PUT 它）
}
```

### PUT /api/v1/settings/pi/dir

写入目录并**立即生效**（服务端重设 `PI_CODING_AGENT_DIR` → 重建模型/设置实例 → 释放当前项目运行时 → 重挂出站 dispatcher），无需重启。

```typescript
// Req
{ dir: string }   // 必须绝对路径（相对路径 / 空串 → 400 VALIDATION_ERROR）

// Res: 200 —— 与 GET 同形（回显新目录）
{ dir: string; defaultDir: string }

// 当前项目有在途对话 → 409 CHAT_BUSY（会话运行时不能中途重建）
// 不拷贝、不迁移旧目录内容（用户自行重配或改回 ~/.pi/agent）
```

### GET /api/v1/settings/config-file/:name

读一份本机配置文件的**整份文本**（设置页「高级」编辑器用）。`name` 是 shared `CONFIG_FILE_NAMES` 白名单（`auth.json` / `models.json` / `settings.json` / `search.json`）→ 服务端映射为绝对路径，**绝不拼接客户端传入值**；白名单外的 name → 400 `VALIDATION_ERROR`。

```typescript
// Res: 200
{
  name: "auth.json" | "models.json" | "settings.json" | "search.json";
  exists: boolean; // false（文件不存在）时 content 为空串
  content: string; // 原文（含明文凭据——只在本机回环端点回传）
}
```

### PUT /api/v1/settings/config-file/:name

整份写入。**先按 pi 的读口径校验**（否则会拒绝 pi 自己读得懂的文件），通过后原子写（`writeTextAtomic`，保留用户缩进与注释），再走与目录同一套「立即生效」。

| 文件 | 位置 | 校验口径 |
| :--- | :--- | :--- |
| `auth.json` | pi 配置目录 | 严格 `JSON.parse`（顶层必须是对象） |
| `models.json` | pi 配置目录 | 宽容：去 `//` 注释与尾逗号后再 parse（与 pi `stripJsonComments` 同口径） |
| `settings.json` | pi 配置目录 | 严格 `JSON.parse`（顶层必须是对象） |
| `search.json` | `~/.ai-editor/` | shared `searchConfigFileSchema`（strict：只认 `{ apiKey?: string }`，未知键拒绝） |

```typescript
// Req
{ content: string }        // 空串允许（= 未配置）

// Res: 200
{ saved: true }

// 校验失败 → 400 VALIDATION_ERROR（含可直接展示给用户的原因），**不写盘**
// 明文凭据纪律：只在这一个本机回环端点（127.0.0.1 + 来源校验）回传，
// 不进日志（http 调试类别只记方法/路径/状态/耗时）、不进备份 / 导出 / 云端 / 项目文件
```

### 不做的事

- **不提供 OAuth 登录流程**（pi 支持的订阅登录不在本仓 UI 范围）：需要订阅凭据的用户用 pi CLI 登录，本仓只读该凭据状态。
- **pi 配置文件仍不做表单**（2026-11 复核）：`auth.json` / `models.json` / `settings.json` 的结构属 pi，表单一改就漂——「高级」tab 对这三份只提供**整份 JSON 文本编辑**。表单化按面推进（已排期的面见 `../design/tasks.md`），开做前必须先解决两条：`parse → stringify` 会丢注释（`models.json` 允许 `//`）与未知键透传；且任何表单都必须仍走这两个端点（校验 + 原子写 + 立即生效三样不重写）。
- **`search.json` 有单字段表单**（2026-11 起）：`apiKey` 走设置页「高级 → 联网搜索」的密码框，写入仍复用 `PUT /settings/config-file/search.json`（服务端 `searchConfigFileSchema` strict 校验不放松）；JSON 编辑器保留为兜底。理由：它是本仓自己的 schema（零上游漂移），而未配置时只有工具报错一条发现路径。
