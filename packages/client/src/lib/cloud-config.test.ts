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

/** 用户**显式设过**设备名（`device` = 配置值，`deviceConfigured` = true） */
const STATUS: CloudStatus = {
  configured: true,
  url: "https://dav.jianguoyun.com/dav/ai-editor",
  username: "me@example.com",
  device: "家里的台式机",
  deviceConfigured: true,
  autoPush: false,
  projectId: "proj-x",
};

/** 用户**没设过**设备名：`device` 是 hostname 派生值，`deviceConfigured` = false（卡 (a) 修的场景） */
const STATUS_UNSET_DEVICE: CloudStatus = { ...STATUS, device: "whispering2333", deviceConfigured: false };

describe("cloudConfigFormFrom（status → 表单预填）", () => {
  it("未配置 / 未加载（null）→ 空表单", () => {
    expect(cloudConfigFormFrom(null)).toEqual(EMPTY_CLOUD_CONFIG_FORM);
  });

  it("已配置 → url/username/device 回显，**password 恒为空串**（服务端不回传密码）", () => {
    expect(cloudConfigFormFrom(STATUS)).toEqual({
      url: STATUS.url,
      username: STATUS.username,
      password: "",
      device: "家里的台式机", // 用户设过的值 → 预填
    });
  });

  it("设备名没设过（device 是派生值）→ **预填空串**（保存不会把派生值钉进配置；卡 (a)）", () => {
    expect(cloudConfigFormFrom(STATUS_UNSET_DEVICE).device).toBe("");
  });

  it("没设过时脏判定对齐空串：原样保存不算改动（保存按钮保持禁用）", () => {
    const form = cloudConfigFormFrom(STATUS_UNSET_DEVICE);
    expect(form.device).toBe("");
    expect(isCloudConfigDirty(form, STATUS_UNSET_DEVICE)).toBe(false); // 不因「派生值 vs 空串」误判为脏
    expect(isCloudConfigDirty({ ...form, device: "家里的台式机" }, STATUS_UNSET_DEVICE)).toBe(true); // 用户主动填 → 脏
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

  it("纯空白密码 = 留空：不提交（否则服务端会当它真密码存下 → configured 却永远 401）", () => {
    for (const blank of ["   ", "\t", " \t "]) {
      const patch = buildCloudConfigPatch({ url: "https://dav/x", username: "u", password: blank, device: "" });
      expect("password" in patch).toBe(false);
    }
    // 非空密码提交**原值**（不做 trim——不改用户密码内容）
    expect(buildCloudConfigPatch({ url: "https://dav/x", username: "u", password: " pw ", device: "" }).password).toBe(
      " pw ",
    );
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

  it("密码为纯空白 = 未改动（与服务端「空白 = 留空」一致：不点亮保存又不产生改动）", () => {
    const base = cloudConfigFormFrom(STATUS);
    expect(isCloudConfigDirty({ ...base, password: "   " }, STATUS)).toBe(false);
    expect(isCloudConfigDirty({ ...base, password: " x " }, STATUS)).toBe(true);
  });

  it("status 未加载（null）：空表单不算改动，填任意字段即算", () => {
    expect(isCloudConfigDirty(EMPTY_CLOUD_CONFIG_FORM, null)).toBe(false);
    expect(isCloudConfigDirty({ ...EMPTY_CLOUD_CONFIG_FORM, url: "https://dav/x" }, null)).toBe(true);
  });
});
