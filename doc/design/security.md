# 安全基线详细设计

> **本文档职责**：回答「本地工具为什么安全、攻击面怎么收」——绑定、来源校验、key 隔离、路径校验的约束与理由。
> 实现契约（端点/配置格式）见 `doc/api/endpoints.md`；部署见 `doc/design/architecture.md`。
> 已过时/被修订决策的完整历史原文可由 `git log` 回溯，本文档只收录**仍生效**的契约。

## 1. 安全基线

**威胁模型**：本地单用户工具的服务进程若被外网/恶意页面利用，即可读写用户全部创作数据。本机绑定 + 全请求来源校验 + key 隔离把攻击面压到最小。

- **绑定**：服务默认绑定 `127.0.0.1`，不对外网开放；生产态端口占用自动 +1 递增（上限 20 次）并打开实际端口；**dev 态被占直接报错**（提示手动指定端口，Vite proxy 写死 3456）。
- **来源校验（全部请求，含读）**：`Origin` 头存在时校验其 host ∈ {`127.0.0.1`, `localhost`, `::1`}；**Origin 缺失**（地址栏直接导航打开首页的常规浏览器行为）时退化为校验 `Host` 头 host ∈ 同一白名单。两者皆拒则拒绝——防 CSRF / DNS rebinding（读操作同样是敏感操作）。
- **不校验端口**：端口因占用自动 +1 可变；dev 态 Vite proxy 转发后 Origin/Host 端口为 5173，校验端口会误杀全部开发请求。DNS rebinding 防护的关键是 host 白名单，端口校验无安全增益。
- **key 隔离（多 provider，批次十六）**：模型 API key 只走三级来源，**绝不进项目文件**（project.json / outline.json / data.db / 备份 zip 天然不含 key）——保持「代码与数据物理隔离」。每 provider 独立解析链：① 环境变量（deepseek → `DEEPSEEK_API_KEY`；opencode-go → `OPENCODE_API_KEY`）→ ② 用户级配置 `~/.ai-editor/config.json` `api_keys[<provider>]`（v1 旧 `api_key` 字段仅对 deepseek 生效）→ ③ pi-agent 配置 `~/.pi/agent/auth.json`（**只读兜底**：`[<provider>]` 项 `type === "api_key"` 且 key 非空才生效，文件不存在/非法/无该项 → 跳过，绝不写回）。
- **模型解析不跨 provider**：模型目录按 provider 隔离，撞名模型（deepseek-v4-flash/pro 两家目录都有）以 `config.provider` 消歧；查不到只在同 provider 内兜底默认，**绝不跨 provider 搜索**——否则撞名模型会用错 key/baseUrl。
- **路径校验**：create/open 时路径需 resolve 规范化、防符号链接逃逸；open 必须校验 `project.json` 存在。

**为什么**：本地创作数据是用户的核心资产，服务进程暴露即数据失守；host 白名单 + 本机绑定把攻击面限制到本机浏览器，key 不进项目文件保证备份/导出/分享永不泄密；pi-agent auth.json 只读兜底让 ai-editor 免配即用（共享本机既有凭据）且永不修改外部文件。
