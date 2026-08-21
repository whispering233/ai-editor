// entity-list 纯函数与配置测试（S3.5）：分页计算、摘要列配置完整性、单元格文案映射、创建首字段配置
import { describe, expect, it } from "vitest";
import { CREATE_FIRST_FIELD, pageCount, SUMMARY_COLUMNS, summaryCellText } from "./entity-list";

describe("pageCount（分页页数计算）", () => {
  it("total 0 → 1 页（空态仍显示「第 1 / 1 页」）", () => {
    expect(pageCount(0, 20)).toBe(1);
  });

  it("整除：total 恰为 limit 倍数", () => {
    expect(pageCount(20, 20)).toBe(1);
    expect(pageCount(40, 20)).toBe(2);
  });

  it("有余数：向上取整", () => {
    expect(pageCount(21, 20)).toBe(2);
    expect(pageCount(1, 20)).toBe(1);
  });
});

describe("SUMMARY_COLUMNS（摘要列配置——原型信息层级表）", () => {
  it("四类型都有列 1（character→role、setting→tags（决策 31）、location→type、hook→status）", () => {
    expect(SUMMARY_COLUMNS.character.key1).toBe("role");
    expect(SUMMARY_COLUMNS.setting.key1).toBe("tags");
    expect(SUMMARY_COLUMNS.location.key1).toBe("type");
    expect(SUMMARY_COLUMNS.hook.key1).toBe("status");
  });

  it("hook 有列 2（payoff_timing）；character 状态列已移除（决策 45）、setting 有列 3 描述（决策 42 表格移除后无列 2）；location 无列 2", () => {
    expect(SUMMARY_COLUMNS.character.key2).toBeUndefined();
    expect(SUMMARY_COLUMNS.hook.key2).toBe("payoff_timing");
    // 决策 42（2026-08 批次十）：设定 tab 改为树形视图（不走表格），「上级设定」特殊列
    // （key2="parent"，M2）随表格移除；「描述」列配置保留
    expect(SUMMARY_COLUMNS.setting.key2).toBeUndefined();
    expect(SUMMARY_COLUMNS.setting.key3).toBe("description");
    expect(SUMMARY_COLUMNS.setting.label3).toBe("描述");
    expect(SUMMARY_COLUMNS.location.key2).toBeUndefined();
  });

  it("timepoint（G2 时间标签点）：无专属摘要字段——空 key（摘要列渲染「—」占位）", () => {
    expect(SUMMARY_COLUMNS.timepoint.key1).toBe("");
    expect(SUMMARY_COLUMNS.timepoint.key2).toBeUndefined();
  });
});

describe("summaryCellText（摘要单元格文案）", () => {
  it("hook status 枚举 → 中文（planted → 已埋设）", () => {
    expect(summaryCellText("hook", "status", "planted")).toBe("已埋设");
    expect(summaryCellText("hook", "status", "progressing")).toBe("推进中");
    expect(summaryCellText("hook", "status", "resolved")).toBe("已回收");
    expect(summaryCellText("hook", "status", "abandoned")).toBe("已弃用");
  });

  it("hook payoff_timing 枚举 → 中文（slow_burn → 慢热）；未收录枚举原样显示", () => {
    expect(summaryCellText("hook", "payoff_timing", "slow_burn")).toBe("慢热");
    expect(summaryCellText("hook", "payoff_timing", "endgame")).toBe("终局");
    expect(summaryCellText("hook", "status", "custom_state")).toBe("custom_state");
  });

  it("非 hook 类型字符串原样；缺失/空值 → 「—」", () => {
    expect(summaryCellText("character", "role", "主角")).toBe("主角");
    expect(summaryCellText("setting", "tags", ["世界", "法则"])).toBe("世界、法则");
    expect(summaryCellText("setting", "tags", [])).toBe("—");
    expect(summaryCellText("character", "role", undefined)).toBe("—");
    expect(summaryCellText("character", "role", null)).toBe("—");
    expect(summaryCellText("character", "role", "")).toBe("—");
  });
});

describe("CREATE_FIRST_FIELD（创建对话框首字段配置——原型「name + 该类型首字段」）", () => {
  it("四类型都有首字段配置", () => {
    expect(CREATE_FIRST_FIELD.character.key).toBe("role");
    // K2（2026-08 用户复核，决策 31）：设定首字段 = tags 分类标签（逗号分隔多值）
    expect(CREATE_FIRST_FIELD.setting.key).toBe("tags");
    expect(CREATE_FIRST_FIELD.setting.input).toBe("tags");
    expect(CREATE_FIRST_FIELD.location.key).toBe("type");
    expect(CREATE_FIRST_FIELD.hook.key).toBe("status");
  });

  it("hook 用枚举下拉（status 受控枚举，doc/database/hooks.md）；其余自由文本", () => {
    expect(CREATE_FIRST_FIELD.hook.input).toBe("select");
    expect(CREATE_FIRST_FIELD.hook.options).toEqual([
      "planted",
      "progressing",
      "resolved",
      "abandoned",
    ]);
    expect(CREATE_FIRST_FIELD.character.input).toBe("text");
  });

  it("timepoint（G2 时间标签点）：空 key = 无 data 首字段（名称即时间标签文本）", () => {
    expect(CREATE_FIRST_FIELD.timepoint.key).toBe("");
  });
});
