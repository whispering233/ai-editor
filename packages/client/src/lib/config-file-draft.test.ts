// 配置文件草稿状态机的单测：核心承诺是「切 tab / 保存失败都不会吃掉用户输入」
import { describe, expect, it } from "vitest";
import {
  fileDirty,
  fileEdited,
  fileFailed,
  fileLoaded,
  fileLoading,
  fileSaveFailed,
  fileSaved,
  initialFileState,
  stateOf,
} from "./config-file-draft";

describe("配置文件草稿状态", () => {
  it("首次加载：draft = saved = 服务端内容，未脏", () => {
    const state = fileLoaded(fileLoading(initialFileState), { exists: true, content: '{"a":1}' });
    expect(state.status).toBe("ready");
    expect(state.draft).toBe('{"a":1}');
    expect(fileDirty(state)).toBe(false);
  });

  it("编辑后变脏；保存成功后 draft 成为新基准", () => {
    const edited = fileEdited(fileLoaded(initialFileState, { exists: true, content: "a" }), "ab");
    expect(fileDirty(edited)).toBe(true);
    const saved = fileSaved(edited);
    expect(saved.saved).toBe("ab");
    expect(saved.exists).toBe(true);
    expect(fileDirty(saved)).toBe(false);
  });

  it("已有草稿时再次加载不覆盖用户输入（切 tab 回来的场景）", () => {
    const edited = fileEdited(fileLoaded(initialFileState, { exists: true, content: "server" }), "local-edit");
    const reloaded = fileLoaded(edited, { exists: true, content: "server-2" });
    expect(reloaded.draft).toBe("local-edit");
    expect(reloaded.saved).toBe("server-2"); // 基准跟随服务端，脏判定仍然正确
    expect(fileDirty(reloaded)).toBe(true);
  });

  it("保存失败保留 draft，只挂错误文案", () => {
    const edited = fileEdited(fileLoaded(initialFileState, { exists: false, content: "" }), "{ 坏 JSON");
    const failed = fileSaveFailed(edited, "settings.json 不是合法 JSON");
    expect(failed.draft).toBe("{ 坏 JSON");
    expect(failed.error).toContain("不是合法 JSON");
    expect(fileDirty(failed)).toBe(true);
  });

  it("拉取失败进入 error 态；已有草稿的槽位不会被拉取态覆盖", () => {
    const failed = fileFailed(fileLoading(initialFileState), "读不到");
    expect(failed.status).toBe("error");
    expect(failed.error).toBe("读不到");

    const ready = fileLoaded(initialFileState, { exists: true, content: "x" });
    expect(fileLoading(ready)).toBe(ready);
  });

  it("stateOf：未访问过的文件返回初始态，且状态更新从不就地改写它", () => {
    const state = stateOf({}, "auth.json");
    expect(state).toEqual(initialFileState);
    // 共享同一个初始对象是安全的：所有更新函数都是纯函数（返回新对象）
    fileEdited(state, "改了");
    fileLoaded(state, { exists: true, content: "x" });
    expect(initialFileState.draft).toBe("");
    expect(initialFileState.status).toBe("idle");
  });
});