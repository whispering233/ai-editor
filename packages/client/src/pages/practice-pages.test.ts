// 三张素材页（`#/author` / `#/works` / `#/style`，卡 6）的源码级守卫。
//
// 为什么用源码扫描：这三页里有两类断言 SSR 看不到——（a）风格说明页的破坏性动作确认框只在打开时挂载
//（关着时不进 SSR 树）；（b）「保存失败必须 `return false`」是 `useSaveShortcut` 的契约
//（prmise 恒 resolve，只有布尔能阻断存档），要跑起来得有 jsdom 点击。
// 与 `pages/dashboard-partitions.test.ts` 同一手法；`.ts` 才能读文件——client 的 `.test.tsx` 会被
// typecheck，而 tsconfig 不含 @types/node。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const styleNotes = readFileSync(new URL("./StyleNotes.tsx", import.meta.url), "utf8");

describe("作家风格说明页（#/style）的破坏性动作", () => {
  it("导入与恢复预置都先过受控确认框（复用 components/ui/dialog.tsx，不新造浮层）", () => {
    expect(styleNotes).toContain('from "@/components/ui/dialog"');
    expect(styleNotes).toMatch(/setPending\("import"\)/);
    expect(styleNotes).toMatch(/setPending\("reset"\)/);
    // 读出的文本先进 pending（确认前不写库）
    expect(styleNotes).toContain("await updatePracticeStylePack(importText)");
  });

  it("确认按钮走 `type=\"primary\" danger`（与删书确认框同口径；`color`+`variant` 会静默忽略 danger 糖）", () => {
    expect(styleNotes).toMatch(/<Button type="primary" danger loading=\{saving\}/);
    expect(styleNotes).not.toMatch(/<Button[^>]*color="danger"[^>]*variant=/);
  });

  it("两个动作各有一句后果声明（用户看得见丢的是什么）", () => {
    expect(styleNotes).toContain("导入会替换当前生效的风格说明，原有内容不再保留。");
    expect(styleNotes).toContain("恢复预置会丢弃当前自定义版本，回到产品预置的风格说明。");
  });

  it("导入走既有文本读取（UTF-8 → GB18030 回落），不自建 FileReader", () => {
    expect(styleNotes).toContain("readTextFile(file)");
    expect(styleNotes).not.toContain("FileReader");
  });
});

describe("作家风格说明页的保存契约", () => {
  it("页内「保存」与全站 `Ctrl/Cmd+S` 走同一个动作，且只在编辑态接快捷键", () => {
    expect(styleNotes).toContain("useSaveShortcut(() => save(), editing)");
    expect(styleNotes).toContain("onSave={() => void save()}");
  });

  it("失败分支返回 `false`（唯一能阻断 Ctrl+S 存档的信号）；空内容不写库（空覆盖等于恢复预置）", () => {
    expect(styleNotes).toMatch(/if \(draft\.trim\(\) === ""\) \{[\s\S]*?return false;/);
    expect(styleNotes).toMatch(/setSaveError\(err instanceof ApiError[\s\S]*?return false;/);
  });

  it("端点调用全部经 lib/api 封装（不自建 fetch）", () => {
    expect(styleNotes).toContain('from "../lib/api"');
    expect(styleNotes).not.toContain("fetch(");
  });
});
