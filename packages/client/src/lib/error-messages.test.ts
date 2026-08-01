// describeOpenError 纯函数测试（S1.4 补丁）：错误码 → 引导文案映射锁定
import { describe, expect, it } from "vitest";
import { describeOpenError } from "./error-messages";

describe("describeOpenError（项目开/建错误码映射）", () => {
  it("INVALID_PROJECT_PATH → 路径引导", () => {
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("绝对路径");
    expect(describeOpenError("INVALID_PROJECT_PATH")).toContain("project.json");
  });

  it("PROJECT_ALREADY_EXISTS → 提示改用打开", () => {
    expect(describeOpenError("PROJECT_ALREADY_EXISTS")).toContain("打开项目");
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
