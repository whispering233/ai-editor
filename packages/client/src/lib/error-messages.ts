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

/**
 * 导入备份错误码 → 引导文案（E3：书架导入对话框内联错误）。
 * - VALIDATION_ERROR / SCHEMA_VERSION_MISMATCH **透传服务端 message**——坏包/缺文件/书名
 *   非法等具体问题由服务端描述，SCHEMA_VERSION_MISMATCH 的 message 已按相对版本分流
 *   （「备份来自更高版本程序」/「备份来自旧版本程序」），透传最准确
 * - PROJECT_ALREADY_EXISTS 本地映射换书名引导（对话框内可立即改名重试）
 */
export function describeImportError(code: string | null, message: string): string {
  switch (code) {
    case "PROJECT_ALREADY_EXISTS":
      return "同名书籍已存在，请换一个书名";
    case "SCHEMA_VERSION_MISMATCH":
      return message;
    case "VALIDATION_ERROR":
      return message;
    case "NO_PROJECT_OPEN":
      return "";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return "导入失败，请稍后重试";
  }
}

/**
 * 导出备份错误码 → 引导文案（E3：书架导出按钮 toast）。
 * 导出失败均为服务端/网络异常（无表单可修正），服务端 message 具体则透传；
 * 仅网络失败映射连接引导
 */
export function describeExportError(code: string | null, message: string): string {
  switch (code) {
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return message;
  }
}
