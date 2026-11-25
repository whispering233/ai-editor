// 设置页「高级」可编辑的本机配置文件（展示层登记表）
//
// **单源纪律**：文件名枚举的唯一来源 = shared `CONFIG_FILE_NAMES`（`@whispering233/ai-editor-shared/schemas`）。
// 客户端不 import 那个模块（它会连带打进 zod），改由 `config-files.test.ts` 断言两份列表逐字同序——
// 不一致就红，而不是靠人记。
import type { ConfigFileName } from "@whispering233/ai-editor-shared/schemas";

/** 一个文件项：名字（= 端点 `:name`）+ tab 标签 + 一句「这是干什么的」 */
export interface ConfigFileEntry {
  name: ConfigFileName;
  label: string;
  hint: string;
}

/** tab 顺序 = 用户理解顺序（凭据 → 自定义模型 → 运行参数 → 搜索） */
export const CONFIG_FILE_ENTRIES: readonly ConfigFileEntry[] = [
  {
    name: "auth.json",
    label: "凭据",
    hint: "各 provider 的 API key / 订阅凭据（一家一条；值可以是字面 key、$ENV_VAR 或 !命令）。与「AI 模型」页的录入框写的是同一份文件。",
  },
  {
    name: "models.json",
    label: "自定义模型",
    hint: "自定义 provider 与模型覆盖（baseUrl、模型元数据）。允许 // 注释与尾逗号（与 pi 的读取口径一致）。与上方「自定义模型」表单写同一份文件：先保存 JSON 再回来用表单。",
  },
  {
    name: "settings.json",
    label: "运行参数",
    hint: "激活模型、可见模型作用域、重试 / 压缩 / 思考预算、出站代理。必须是严格 JSON（不支持注释）。重试 / 压缩 / 空闲超时三个键的屏幕表单在上方「运行参数」卡，这里只写其余字段。",
  },
  {
    name: "search.json",
    label: "搜索凭据",
    hint: "联网检索 / 网页抓取的 API key（只接受 { \"apiKey\": \"...\" }）。搜索目前只接入 DeepSeek，与对话 key 是两份独立配置。",
  },
] as const;

/** 名字 → 展示项（找不到返回 undefined：端点白名单是另一道闸） */
export function configFileEntry(name: string): ConfigFileEntry | undefined {
  return CONFIG_FILE_ENTRIES.find((entry) => entry.name === name);
}