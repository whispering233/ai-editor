// 云端状态层测试（卡 2）：cloud.json 的读写/合并写/权限/设备名解析
//
// 契约：docs/design/40-cloud-sync.md §7、docs/design/config.md「读写边界」、docs/api/100-api-cloud.md。
// 隔离：每个用例一个临时创作根 + `initCloudState(root)`；用例后复位 `null`（模块级状态，
// 防止污染其它用例——尤其 backup 管道的设备名解析）。
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultDeviceName } from "../device-name.js";
import { currentDeviceName } from "./device.js";
import {
  cloudConfigPath,
  configuredDeviceName,
  initCloudState,
  readAutoPush,
  readCloudFile,
  readWebdavConfig,
  writeCloudConfig,
} from "./state.js";

let root: string;
/** 读写测试用配置路径（<创作根>/.ai-editor/cloud.json） */
const configPath = (): string => join(root, ".ai-editor", "cloud.json");

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ai-editor-cloud-state-"));
  initCloudState(root);
});

afterEach(() => {
  initCloudState(null);
  rmSync(root, { recursive: true, force: true });
});

describe("云端配置读取（宽松语义）", () => {
  it("未配置：文件不存在 → 全部按「未配置」处理（不抛错）", () => {
    expect(cloudConfigPath()).toBe(configPath());
    expect(readCloudFile()).toBeNull();
    expect(readWebdavConfig()).toBeNull();
    expect(configuredDeviceName()).toBeNull();
    expect(readAutoPush()).toBe(false);
  });

  it("文件损坏（非法 JSON / 顶层非对象）→ 视为未配置", () => {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(configPath(), "{ 不是 JSON");
    expect(readCloudFile()).toBeNull();
    writeFileSync(configPath(), '"字符串不是对象"');
    expect(readCloudFile()).toBeNull();
    expect(readWebdavConfig()).toBeNull();
  });

  it("webdav 三项缺一即未配置（url/username/password 都要求非空）", () => {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(configPath(), JSON.stringify({ webdav: { url: "https://dav.example.com/dav", username: "u" } }));
    expect(readWebdavConfig()).toBeNull();
    writeFileSync(
      configPath(),
      JSON.stringify({ webdav: { url: "https://dav.example.com/dav", username: "u", password: "" } }),
    );
    expect(readWebdavConfig()).toBeNull();
  });

  it("三项齐备 → 已配置（url/username 去首尾空白；device 可选）", () => {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({
        webdav: { url: "  https://dav.example.com/dav  ", username: " me@example.com ", password: "app-pw", device: " 苹果本 " },
      }),
    );
    expect(readWebdavConfig()).toEqual({
      url: "https://dav.example.com/dav",
      username: "me@example.com",
      password: "app-pw",
      device: "苹果本",
    });
  });

  it("未初始化创作根：读取一律未配置（写入见下）", () => {
    initCloudState(null);
    expect(cloudConfigPath()).toBeNull();
    expect(readCloudFile()).toBeNull();
    expect(readWebdavConfig()).toBeNull();
    expect(currentDeviceName()).toBe(defaultDeviceName());
  });
});

describe("云端配置写入（合并写 + 0600）", () => {
  it("创建即 0600，且**重写后仍是 0600**（原子写临时文件按 0600 创建，rename 保持模式）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "pw" });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
    writeCloudConfig({ autoPush: true });
    expect(statSync(configPath()).mode & 0o777).toBe(0o600);
  });

  it("写入后三项齐备 → 已配置；响应对象只含配置项（password 属调用方零回传）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav/", username: "u", password: "pw" });
    expect(readWebdavConfig()).toEqual({ url: "https://dav.example.com/dav/", username: "u", password: "pw" });
  });

  it("缺省键不修改：password 未传 → 保留原值；autoPush 未传 → 保留", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "旧密码", autoPush: true });
    writeCloudConfig({ username: "u2" });
    expect(readWebdavConfig()).toEqual({ url: "https://dav.example.com/dav", username: "u2", password: "旧密码" });
    expect(readAutoPush()).toBe(true);
  });

  it("未知顶层键（含 books 段）原样保留（前向兼容：后续卡片写入的同步状态不被覆盖）", () => {
    mkdirSync(join(root, ".ai-editor"), { recursive: true });
    writeFileSync(
      configPath(),
      JSON.stringify({
        webdav: { url: "https://dav.example.com/dav", username: "u", password: "pw" },
        books: { "proj-a": { dirName: "书-proj-a", lastPushedFileName: "x.zip" } },
        unknownKey: { keep: true },
      }),
    );
    writeCloudConfig({ autoPush: true });
    const file = readCloudFile() as Record<string, unknown>;
    expect(file.books).toEqual({ "proj-a": { dirName: "书-proj-a", lastPushedFileName: "x.zip" } });
    expect(file.unknownKey).toEqual({ keep: true });
    expect(readAutoPush()).toBe(true);
  });

  it("三项齐空 → 删除凭据段（回到未配置）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "pw", autoPush: true });
    writeCloudConfig({ url: null, username: null, password: null });
    expect(readWebdavConfig()).toBeNull();
    expect(readAutoPush()).toBe(true); // autoPush 是独立键，不受凭据清除影响
  });

  it("清除凭据但设备名非空 → 保留设备名（设备不是凭据，仍作用于备份文件名）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "pw", device: "苹果本" });
    writeCloudConfig({ url: null, username: null, password: null });
    expect(readWebdavConfig()).toBeNull(); // 未配置（三项不齐）
    expect(configuredDeviceName()).toBe("苹果本"); // 但设备名还在
  });

  it("凭据三件套要么齐、要么全无：url 与 username 皆空 ⇒ password 一并丢弃（oracle 卡 2 F3）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "SECRET-PW" });
 // UI「清除凭据」流程：清空 url + username，密码框留空（patch 不传 password）
    writeCloudConfig({ url: "", username: "" });
    expect(JSON.stringify(readCloudFile())).not.toContain("SECRET-PW");
    expect(readWebdavConfig()).toBeNull();
 // 仅清 url（username 仍在）→ 未配置，但密码保留（尚未真正「清空凭据」）
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "SECRET-PW" });
    writeCloudConfig({ url: "" });
    expect(readWebdavConfig()).toBeNull();
    expect(JSON.stringify(readCloudFile())).toContain("SECRET-PW");
  });

  it("autoPush 显式 false 落盘（读侧 true/false 往返）", () => {
    writeCloudConfig({ autoPush: true });
    expect(readAutoPush()).toBe(true);
    writeCloudConfig({ autoPush: false });
    expect(readAutoPush()).toBe(false);
  });

  it("设备名等于应用密码 → 400（凭据不得进文件名段），且零落盘", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "atqrrh2u3k8mp57p" });
    const before = readFileSync(configPath(), "utf8");
    expect(() => writeCloudConfig({ device: "atqrrh2u3k8mp57p" })).toThrowError(/设备名不能与 WebDAV 应用密码相同/);
    expect(readFileSync(configPath(), "utf8")).toBe(before); // 抛错发生在写盘前
    expect(configuredDeviceName()).toBeNull();
  });

  it("同一请求里新设的密码 + 新设的设备名也挡（比较用生效值，不留到下次保存才发现）", () => {
    expect(() =>
      writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "atqrrh2u3k8mp57p", device: "atqrrh2u3k8mp57p" }),
    ).toThrowError(/设备名不能与 WebDAV 应用密码相同/);
    expect(readCloudFile()).toBeNull(); // 整个请求零落盘（不留下半套凭据）
  });

  it("密码带首尾空白（粘贴常带空格）按 trim 口径挡；清除凭据后同值设备名放行", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: " atqrrh2u3k8mp57p ", device: "台式机" });
    expect(() => writeCloudConfig({ device: "atqrrh2u3k8mp57p" })).toThrowError(/应用密码相同/);
    writeCloudConfig({ url: null, username: null, password: null }); // 清除凭据（密码一并丢弃）
    writeCloudConfig({ device: "atqrrh2u3k8mp57p" }); // 不再是凭据 → 放行
    expect(configuredDeviceName()).toBe("atqrrh2u3k8mp57p");
  });

  it("未初始化创作根 → 写入 500 INTERNAL_ERROR（装配错误不静默吞）", () => {
    initCloudState(null);
    expect(() => writeCloudConfig({ autoPush: true })).toThrowError(/创作根未初始化/);
  });

  it("落盘 JSON 是 2 空格缩进 + 尾换行（与仓库其它配置文件的原子写格式一致）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "pw" });
    const raw = readFileSync(configPath(), "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw).toContain('\n  "webdav"');
  });
});

describe("设备名解析（配置优先，缺省 hostname 派生）", () => {
  it("合法配置值生效", () => {
    writeCloudConfig({ device: "家里的台式机" });
    expect(configuredDeviceName()).toBe("家里的台式机");
    expect(currentDeviceName()).toBe("家里的台式机");
  });

  it("非法配置值（含 `-` / 纯空白）不生效 → 回缺省 hostname", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "pw" });
    // 绕过路由层直接写盘（模拟手工编辑/旧版本写入的脏值）
    const file = readCloudFile() as Record<string, unknown>;
    writeFileSync(configPath(), JSON.stringify({ ...file, webdav: { ...(file.webdav as object), device: "MacBook-Pro" } }));
    expect(configuredDeviceName()).toBeNull();
    expect(currentDeviceName()).toBe(defaultDeviceName());
  });

  it("配置清除 → 回缺省 hostname", () => {
    writeCloudConfig({ device: "苹果本" });
    writeCloudConfig({ device: null });
    expect(configuredDeviceName()).toBeNull();
    expect(currentDeviceName()).toBe(defaultDeviceName());
  });

  it("存量坏值（设备名 == 应用密码）→ 读侧按未配置处理（回退 hostname，立刻止漏）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "atqrrh2u3k8mp57p" });
    // 绕过写守卫直接写盘（模拟旧版本/手工编辑留下的坏配置）
    const file = readCloudFile() as Record<string, unknown>;
    writeFileSync(
      configPath(),
      JSON.stringify({ ...file, webdav: { ...(file.webdav as object), device: "atqrrh2u3k8mp57p" } }),
    );
    expect(configuredDeviceName()).toBeNull();
    expect(currentDeviceName()).toBe(defaultDeviceName());
  });

  it("设备名与密码同值时，清掉密码后设备名重新生效（守卫只跟凭据绑定）", () => {
    writeCloudConfig({ url: "https://dav.example.com/dav", username: "u", password: "atqrrh2u3k8mp57p" });
    const file = readCloudFile() as Record<string, unknown>;
    writeFileSync(
      configPath(),
      JSON.stringify({ ...file, webdav: { ...(file.webdav as object), device: "atqrrh2u3k8mp57p" } }),
    );
    expect(configuredDeviceName()).toBeNull();
    writeCloudConfig({ url: null, username: null, password: null }); // 密码一并丢弃
    expect(configuredDeviceName()).toBe("atqrrh2u3k8mp57p");
  });
});
