// describeOpenError 纯函数测试（S1.4 补丁）：错误码 → 引导文案映射锁定
// E3 追加：describeImportError / describeExportError（导出/导入错误码映射）
import { describe, expect, it } from "vitest";
import { describeExportError, describeImportError, describeOpenError } from "./error-messages";

describe("describeOpenError（项目开/建错误码映射）", () => {
  it("INVALID_PROJECT_PATH → 路径引导", () => {
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("绝对路径");
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("project.json");
  });

  it("PROJECT_ALREADY_EXISTS → 提示直接打开（书架形态，S1.5 修订文案）", () => {
    expect(describeOpenError("PROJECT_ALREADY_EXISTS")).toContain("打开");
  });

  it("PROJECT_VERSION_NEWER → 升级程序引导（E4：项目由更高版本创建，open 409）", () => {
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

describe("describeImportError（E3 导入错误码映射）", () => {
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

describe("describeExportError（E3 导出错误码映射）", () => {
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
