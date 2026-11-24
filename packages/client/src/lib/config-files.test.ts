// 展示层文件清单与服务端白名单必须逐字同序（客户端不 import 那个模块：会连带打进 zod）
import { CONFIG_FILE_NAMES } from "@whispering233/ai-editor-shared/schemas";
import { describe, expect, it } from "vitest";
import { CONFIG_FILE_ENTRIES, configFileEntry } from "./config-files";

describe("本机配置文件清单", () => {
  it("与 shared CONFIG_FILE_NAMES 逐字同序（新增文件必须两处同时改）", () => {
    expect(CONFIG_FILE_ENTRIES.map((entry) => entry.name)).toEqual([...CONFIG_FILE_NAMES]);
  });

  it("每个文件项都有非空标签与说明", () => {
    for (const entry of CONFIG_FILE_ENTRIES) {
      expect(entry.label.trim()).not.toBe("");
      expect(entry.hint.trim()).not.toBe("");
    }
  });

  it("configFileEntry 按名字查，未知名字返回 undefined", () => {
    expect(configFileEntry("auth.json")?.label).toBe("凭据");
    expect(configFileEntry("../package.json")).toBeUndefined();
  });
});