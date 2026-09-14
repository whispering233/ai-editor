// lib/cloud-config 纯函数测试（卡 3）：表单 ↔ API 补丁 / 预填 / 脏判定
//
// 契约：docs/api/100-api-cloud.md 的 PUT /cloud/config（卡 2 服务端语义）；
// 关键语义（卡 2 oracle 复核第 1/2 条）：密码留空不提交、凭据不全不提交密码、双清空即清凭据。
import { describe, expect, it } from "vitest";
import type { CloudStatus } from "@whispering233/ai-editor-shared";
import {
  EMPTY_CLOUD_CONFIG_FORM,
  buildCloudConfigPatch,
  cloudConfigFormFrom,
  isCloudConfigDirty,
  isCredentialHalfFilled,
} from "./cloud-config";

const STATUS: CloudStatus = {
  configured: true,
  url: "https://dav.jianguoyun.com/dav/ai-editor",
  username: "me@example.com",
  device: "家里的台式机",
  autoPush: false,
  projectId: "proj-x",
};

describe("cloudConfigFormFrom（status → 表单预填）", () => {
  it("未配置 / 未加载（null）→ 空表单", () => {
    expect(cloudConfigFormFrom(null)).toEqual(EMPTY_CLOUD_CONFIG_FORM);
  });

  it("已配置 → url/username/device 回显，**password 恒为空串**（服务端不回传密码）", () => {
    expect(cloudConfigFormFrom(STATUS)).toEqual({
      url: STATUS.url,
      username: STATUS.username,
      password: "",
      device: "家里的台式机", // 预填生效值（可能是 hostname 派生值）
    });
  });

  it("已配置但 url/username 缺失（异常态）→ 回显空串，不抛错", () => {
    const form = cloudConfigFormFrom({ ...STATUS, configured: false, url: null, username: null });
    expect(form.url).toBe("");
    expect(form.username).toBe("");
  });
});

describe("buildCloudConfigPatch（表单 → PUT /cloud/config 补丁）", () => {
  it("密码留空 → 不提交 password（服务端 = 保留原值）", () => {
    const patch = buildCloudConfigPatch({ ...EMPTY_CLOUD_CONFIG_FORM, url: "https://dav/x", username: "u" });
    expect(patch).toEqual({ url: "https://dav/x", username: "u", device: "" });
    expect("password" in patch).toBe(false);
  });

  it("密码非空且凭据齐 → 提交 password", () => {
    const patch = buildCloudConfigPatch({ url: "https://dav/x", username: "u", password: "app-pw", device: "苹果本" });
    expect(patch).toEqual({ url: "https://dav/x", username: "u", password: "app-pw", device: "苹果本" });
  });

  it("凭据不全（地址或用户名为空）→ **即使填了密码也不提交**（服务端会静默丢弃，不能骗用户）", () => {
    for (const form of [
      { url: "", username: "u", password: "app-pw", device: "" },
      { url: "https://dav/x", username: "", password: "app-pw", device: "" },
      { url: "   ", username: "u", password: "app-pw", device: "" },
    ]) {
      expect("password" in buildCloudConfigPatch(form)).toBe(false);
    }
  });

  it("双清空（地址 + 用户名都空）→ 三者照传空串（服务端不变式：url/username 皆空 ⇒ password 一并丢弃 = 清除凭据）", () => {
    expect(buildCloudConfigPatch({ ...EMPTY_CLOUD_CONFIG_FORM, password: "旧密码" })).toEqual({
      url: "",
      username: "",
      device: "",
    });
  });

  it("首尾空白被 trim；device 清空照传空串（= 回退本机名派生）", () => {
    expect(buildCloudConfigPatch({ url: "  https://dav/x  ", username: "  u  ", password: "", device: "  苹果本  " })).toEqual({
      url: "https://dav/x",
      username: "u",
      device: "苹果本",
    });
  });
});

describe("isCredentialHalfFilled（凭据填了一半）", () => {
  it("都空 / 都填 → false；只填一个 → true（含纯空白）", () => {
    expect(isCredentialHalfFilled(EMPTY_CLOUD_CONFIG_FORM)).toBe(false);
    expect(isCredentialHalfFilled({ ...EMPTY_CLOUD_CONFIG_FORM, url: "https://dav/x", username: "u" })).toBe(false);
    expect(isCredentialHalfFilled({ ...EMPTY_CLOUD_CONFIG_FORM, url: "https://dav/x" })).toBe(true);
    expect(isCredentialHalfFilled({ ...EMPTY_CLOUD_CONFIG_FORM, username: "u" })).toBe(true);
    expect(isCredentialHalfFilled({ ...EMPTY_CLOUD_CONFIG_FORM, url: "   ", username: "u" })).toBe(true);
  });
});

describe("isCloudConfigDirty（未保存改动判定）", () => {
  it("预填后未改动 → false（保存按钮禁用）", () => {
    expect(isCloudConfigDirty(cloudConfigFormFrom(STATUS), STATUS)).toBe(false);
  });

  it("改 url / username / device 或填入密码 → true", () => {
    const base = cloudConfigFormFrom(STATUS);
    expect(isCloudConfigDirty({ ...base, url: `${STATUS.url}/x` }, STATUS)).toBe(true);
    expect(isCloudConfigDirty({ ...base, username: "other@example.com" }, STATUS)).toBe(true);
    expect(isCloudConfigDirty({ ...base, device: "办公室台式机" }, STATUS)).toBe(true);
    expect(isCloudConfigDirty({ ...base, password: "new-pw" }, STATUS)).toBe(true);
  });

  it("status 未加载（null）：空表单不算改动，填任意字段即算", () => {
    expect(isCloudConfigDirty(EMPTY_CLOUD_CONFIG_FORM, null)).toBe(false);
    expect(isCloudConfigDirty({ ...EMPTY_CLOUD_CONFIG_FORM, url: "https://dav/x" }, null)).toBe(true);
  });
});
