// 错误码 → 引导文案映射（纯函数，S1.4）
// 契约来源：doc/ui/layout.md §3.2「错误横幅：code + message，按错误码给出引导文案（各页定义映射）」
// 用途：Dashboard 项目开/建页的表单错误提示；页面分支用 loadError 判断形态（如 NO_PROJECT_OPEN
//   引导开/建、CLIENT_NETWORK_ERROR 连接失败重试），本函数负责文案层

/**
 * 项目开/建相关错误码 → 用户可读引导文案
 * @param code 错误码（服务端 ErrorCode / 客户端 CLIENT_NETWORK_ERROR / 未知 / null）
 * @returns 引导文案；NO_PROJECT_OPEN 返回空串（该码不产生表单错误，由页面分支处理）
 */
export function describeOpenError(code: string | null): string {
  switch (code) {
    case "INVALID_PROJECT_PATH":
      return "路径无效：请使用绝对路径，且目标目录须已含 project.json（不是项目目录）";
    case "PROJECT_ALREADY_EXISTS":
      // S1.5 修订：书架形态下对应动作是列表行「打开」或折叠区「打开其他路径」
      return "该目录已是项目，请直接打开（书架列表或「打开其他路径」）";
    case "NO_PROJECT_OPEN":
      return "";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return "操作失败，请稍后重试";
  }
}
