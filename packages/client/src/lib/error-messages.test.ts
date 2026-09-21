// describeOpenError 纯函数测试（S1.4 补丁）：错误码 → 引导文案映射锁定
// 追加：describeImportError / describeExportError（导出/导入错误码映射）/ describeDecomposeError（拆解）
import { describe, expect, it } from "vitest";
import {
  describeDecomposeError,
  describeDeleteBookError,
  describeExportError,
  describeImportError,
  describeOpenError,
} from "./error-messages";

describe("describeOpenError（项目开/建错误码映射）", () => {
  it("INVALID_PROJECT_PATH → 路径引导", () => {
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("绝对路径");
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("project.json");
  });

  it("PROJECT_ALREADY_EXISTS → 提示直接打开（书架形态，S1.5 修订文案）", () => {
    expect(describeOpenError("PROJECT_ALREADY_EXISTS")).toContain("打开");
  });

  it("PROJECT_VERSION_NEWER → 升级程序引导（项目由更高版本创建，open 409）", () => {
    expect(describeOpenError("PROJECT_VERSION_NEWER")).toContain("升级");
  });

  it("NO_PROJECT_OPEN → 空串（页面分支处理，不产生表单错误）", () => {
    expect(describeOpenError("NO_PROJECT_OPEN")).toBe("");
  });

  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeOpenError("CLIENT_NETWORK_ERROR")).toContain("无法连接服务");
  });

  it("未知错误码与 null → 兜底文案", () => {
    expect(describeOpenError("SOME_UNKNOWN_CODE")).toBe("操作失败，请稍后重试");
    expect(describeOpenError(null)).toBe("操作失败，请稍后重试");
  });
});

describe("describeImportError（导入错误码映射）", () => {
  it("PROJECT_ALREADY_EXISTS → 换书名引导（对话框内可立即改名重试）", () => {
    expect(describeImportError("PROJECT_ALREADY_EXISTS", "书架已存在同名书: x")).toContain(
      "换一个书名",
    );
  });

  it("SCHEMA_VERSION_MISMATCH → 透传服务端 message（含相对版本分流文案）", () => {
    const higher = "备份包 data.db 版本 (2) 备份来自更高版本程序（当前程序 1），暂不支持导入";
    expect(describeImportError("SCHEMA_VERSION_MISMATCH", higher)).toContain("更高版本程序");
    const lower = "备份包 data.db 版本 (0) 备份来自旧版本程序（当前程序 1），暂不支持导入";
    expect(describeImportError("SCHEMA_VERSION_MISMATCH", lower)).toContain("旧版本程序");
  });

  it("VALIDATION_ERROR → 透传服务端 message（坏包/缺文件等具体问题描述）", () => {
    expect(
      describeImportError("VALIDATION_ERROR", "不是有效的项目备份包（zip 解析失败）"),
    ).toContain("zip");
    expect(describeImportError("VALIDATION_ERROR", "备份包缺少文件: outline.json")).toContain(
      "outline.json",
    );
  });

  it("NO_PROJECT_OPEN → 空串（页面分支处理）", () => {
    expect(describeImportError("NO_PROJECT_OPEN", "x")).toBe("");
  });

  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeImportError("CLIENT_NETWORK_ERROR", "x")).toContain("无法连接服务");
  });

  it("未知错误码与 null → 兜底文案", () => {
    expect(describeImportError("SOME_UNKNOWN", "x")).toBe("导入失败，请稍后重试");
    expect(describeImportError(null, "x")).toBe("导入失败，请稍后重试");
  });
});

describe("describeExportError（导出错误码映射）", () => {
  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeExportError("CLIENT_NETWORK_ERROR", "x")).toContain("无法连接服务");
  });

  it("服务端 message 透传（NO_PROJECT_OPEN / INTERNAL_ERROR / 未知码）", () => {
    expect(describeExportError("NO_PROJECT_OPEN", "未打开项目")).toBe("未打开项目");
    expect(describeExportError("INTERNAL_ERROR", "项目数据文件缺失，无法导出: data.db")).toBe(
      "项目数据文件缺失，无法导出: data.db",
    );
    expect(describeExportError(null, "导出失败，请重试")).toBe("导出失败，请重试");
  });
});

describe("describeDecomposeError（拆解小说错误码映射）", () => {
  it("DECOMPOSE_FILE_TOO_LARGE / DECOMPOSE_FILE_INVALID / VALIDATION_ERROR → 透传服务端 message", () => {
    // 上限值 / 空文本判定都是服务端单一实现，客户端不复述数字
    expect(
      describeDecomposeError("DECOMPOSE_FILE_TOO_LARGE", "文件超过体积上限 16MB，请改用更小的文本文件"),
    ).toContain("16MB");
    expect(
      describeDecomposeError("DECOMPOSE_FILE_INVALID", "文件没有可解析的文本（空文件或非文本内容）"),
    ).toContain("没有可解析的文本");
    expect(describeDecomposeError("VALIDATION_ERROR", "file_name 不能为空")).toBe("file_name 不能为空");
  });

  it("PROJECT_ALREADY_EXISTS → 换书名引导（框内可立即改名重试）", () => {
    expect(describeDecomposeError("PROJECT_ALREADY_EXISTS", "同名书籍已存在: /x/y")).toContain(
      "换一个书名",
    );
  });

  it("LLM_API_KEY_MISSING → 设置页引导（两种服务端 message 共用一句用户动作）", () => {
    expect(describeDecomposeError("LLM_API_KEY_MISSING", "未配置可用模型：请先在设置页选择模型")).toContain(
      "设置页",
    );
    expect(describeDecomposeError("LLM_API_KEY_MISSING", "未配置 openai 的凭据")).toContain("设置页");
  });

  it("CLIENT_NETWORK_ERROR → 连接失败引导", () => {
    expect(describeDecomposeError("CLIENT_NETWORK_ERROR", "Failed to fetch")).toContain("无法连接服务");
  });

  it("未知码 / null：有 message 透传，空 message 兜底", () => {
    expect(describeDecomposeError("SOME_UNKNOWN", "服务端内部错误")).toBe("服务端内部错误");
    expect(describeDecomposeError(null, "")).toBe("拆解失败，请稍后重试");
  });
});

describe("describeDeleteBookError（删书框内文案，卡 23.5）", () => {
  it("409 CLOUD_CONFLICT：透传服务端 message（含两份文件名）并写明本机未删任何东西", () => {
    const text = describeDeleteBookError(
      "CLOUD_CONFLICT",
      "云端已有更新的备份（2026-09-21-auto-本机-人物1-设定2-章3.zip），本机上次推送的是 （无记录）",
    );
    expect(text).toContain("2026-09-21-auto-本机-人物1-设定2-章3.zip");
    expect(text).toContain("本机未删除任何东西");
  });

  it("其他推送链路失败（502 CLOUD_UNREACHABLE / 400 CLOUD_BACKUP_TOO_LARGE）同口径", () => {
    expect(describeDeleteBookError("CLOUD_UNREACHABLE", "云盘不可达")).toContain("未删除任何东西");
    expect(
      describeDeleteBookError("CLOUD_BACKUP_TOO_LARGE", "备份包 600MB 超过云盘单文件上限"),
    ).toContain("云盘单文件上限");
  });

  it("INVALID_PROJECT_PATH → 刷新书架引导；CLIENT_NETWORK_ERROR → 连接引导", () => {
    expect(describeDeleteBookError("INVALID_PROJECT_PATH", "目录不存在")).toContain("刷新书架");
    expect(describeDeleteBookError("CLIENT_NETWORK_ERROR", "Failed to fetch")).toContain("无法连接服务");
  });

  it("删除动作本身的失败（INTERNAL_ERROR）不声称「未删除」——只透传服务端 message", () => {
    const text = describeDeleteBookError("INTERNAL_ERROR", "移除目录失败");
    expect(text).toBe("移除目录失败");
    expect(text).not.toContain("未删除任何东西");
  });

  it("未知码 / null：有 message 透传，空 message 兜底", () => {
    expect(describeDeleteBookError("SOME_UNKNOWN", "服务端内部错误")).toBe("服务端内部错误");
    expect(describeDeleteBookError(null, "")).toBe("删除失败，请稍后重试");
    expect(describeDeleteBookError("CLOUD_CONFLICT", "")).toBe("删除前的云端推送未成功——本机未删除任何东西");
  });
});
