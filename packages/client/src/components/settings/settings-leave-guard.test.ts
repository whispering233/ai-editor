// 设置页离开守卫接线守卫（A4）：七处草稿源必须各自报到 `useRegisterDirty(<其 dirty>)`。
// 为什么是源码扫描：这七处散落在五个二级 tab 的组件里，漏一处 = 该处草稿静默丢（不报错、不崩），
// 而运行时断言要逐面板渲染成 dirty 态，成本远高于这条一次性扫描；DESIGN.md `settings-leave-guard`
// 的清单就是断言对象——新增手写保存的草稿源时，必须同时把它加进这里。
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = fileURLToPath(new URL(".", import.meta.url));

/** 七处草稿源（相对本文件）：任一漏报到 ⇒ 那个面板的未保存修改会被静默丢弃 */
const DRAFT_SOURCES = [
  "project-rules-section.tsx", // 项目规则（AGENTS.md 文本）
  "config-file-editor.tsx", // 本机配置文件（四槽共用一份草稿表：任一槽脏都算）
  "search-key-panel.tsx", // 联网搜索 key
  "pi-dir-panel.tsx", // pi 配置目录
  "runtime-params-panel.tsx", // 运行参数（三个控件）
  "cloud-backup-panel.tsx", // 云端账号表单
  "llm-section.tsx", // 各家 API key 输入框（非空即算）
];

describe("设置页离开守卫", () => {
  it("七处草稿源都调用 useRegisterDirty(", () => {
    const missing = DRAFT_SOURCES.filter(
      (file) => !readFileSync(DIR + file, "utf8").includes("useRegisterDirty("),
    );
    expect(missing).toEqual([]);
  });

  it("配置文件编辑器按**全部槽位**判脏（切到别的槽再离开也不能丢稿）", () => {
    const source = readFileSync(DIR + "config-file-editor.tsx", "utf8");
    expect(source).toContain("useRegisterDirty(Object.values(files).some(fileDirty))");
  });
});
