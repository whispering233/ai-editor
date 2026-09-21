// 错误码 → 引导文案映射（纯函数，S1.4）
// 用途：Dashboard 项目开/建页的表单错误提示；页面分支用 loadError 判断形态（如 NO_PROJECT_OPEN
// 引导开/建、CLIENT_NETWORK_ERROR 连接失败重试），本函数负责文案层

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
    case "PROJECT_VERSION_NEWER":
 // 项目由更高版本程序创建（open 409，堵降级数据丢失）
      return "该项目由更高版本的 ai-editor 创建，请升级程序后再打开（避免降级导致数据丢失）";
    case "NO_PROJECT_OPEN":
      return "";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    default:
      return "操作失败，请稍后重试";
  }
}

/**
 * 导入备份错误码 → 引导文案（书架导入对话框内联错误）。
 * - VALIDATION_ERROR / SCHEMA_VERSION_MISMATCH **透传服务端 message**——坏包/缺文件/书名
 * 非法等具体问题由服务端描述，SCHEMA_VERSION_MISMATCH 的 message 已按相对版本分流
 * （「备份来自更高版本程序」/「备份来自旧版本程序」），透传最准确
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
 * 导出备份错误码 → 引导文案（书架导出按钮 toast）。
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

/**
 * 删书错误码 → 框内文案（`book-delete-dialog`；推送失败分支可选 `force` 继续）。
 * - **删除前的云端推送失败**（409 `CLOUD_CONFLICT` / 400 `CLOUD_BACKUP_TOO_LARGE` / 502 三码）：
 *   服务端在删任何东西之前就中止了——服务端 message 已中文可读（含两份文件名等具体信息），
 *   本地补上「本机未删除任何东西」这句结论；仍要删除由框内按钮（force）决定。
 * - `INVALID_PROJECT_PATH`：书目录已不在（另有窗口删过 / 被移动）。其余码透传服务端 message
 *  （不在这类码上声称「未删除」：删除动作本身失败是可能的，不许把不确定说成事实）。
 */
export function describeDeleteBookError(code: string | null, message: string): string {
  switch (code) {
    case "INVALID_PROJECT_PATH":
      return "该书已不在书架目录里（可能已被删除或被移动），请刷新书架";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    case "CLOUD_CONFLICT":
    case "CLOUD_BACKUP_TOO_LARGE":
    case "CLOUD_AUTH_FAILED":
    case "CLOUD_UNREACHABLE":
    case "CLOUD_QUOTA_EXCEEDED":
      return `${message === "" ? "删除前的云端推送未成功" : message}——本机未删除任何东西`;
    default:
      return message === "" ? "删除失败，请稍后重试" : message;
  }
}

/**
 * 拆解小说错误码 → 框内引导文案（拆解对话框；失败与警告一律落框内，不另开提示）。
 * - 体积 / 文本 / 校验类**透传服务端 message**：上限值、空文本判定都由服务端单一实现，
 *   客户端不复述数字（同一数值两处出现必然漂移）。
 * - `PROJECT_ALREADY_EXISTS` 本地映射换书名引导（框内可立即改名重试）。
 * - `LLM_API_KEY_MISSING` 本地映射设置页引导：服务端 message 分「模型未选」「凭据缺失」两种，
 *   框内一句话盖住两态（用户动作都是去设置页）。
 */
export function describeDecomposeError(code: string | null, message: string): string {
  switch (code) {
    case "PROJECT_ALREADY_EXISTS":
      return "同名书籍已存在，请换一个书名";
    case "LLM_API_KEY_MISSING":
      return "未配置可用模型或 API key，请到设置页配置后再试";
    case "CLIENT_NETWORK_ERROR":
      return "无法连接服务，请确认 ai-editor 服务已启动";
    case "VALIDATION_ERROR":
    case "DECOMPOSE_FILE_TOO_LARGE":
    case "DECOMPOSE_FILE_INVALID":
      return message;
    default:
      return message === "" ? "拆解失败，请稍后重试" : message;
  }
}
