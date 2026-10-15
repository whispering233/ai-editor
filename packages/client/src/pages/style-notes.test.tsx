// 作家风格说明页（`#/style`）SSR 走查（卡 6）：仓内无 jsdom/@testing-library，用 `react-dom/server` 直渲染。
// 契约依据 = `docs/ui/DESIGN.md` §作家文风练习区「作家风格说明」（页头常驻模板；渲染态 = `card` 面 markdown；
// 页头右端组 `[编辑]` `[导入 .md]` `[恢复预置]`；编辑态 `Input.TextArea` + `[保存]`（primary）+ `[取消]`；
// 有覆盖时一行「当前为自定义版本」；导入 / 恢复预置**都要先过 danger 确认框**）
// + `docs/api/120-api-practice.md`「作家风格说明素材包」（读 = 覆盖 `??` 预置，`customized` 判覆盖）。
//
// 覆盖：三种页面态（渲染 / 编辑 / 加载·失败）+ 覆盖态文案与 [恢复预置] 的出现条件 + 上限提示取常量
// + 作家未解析的空态（不崩、不空白）。**确认框 / 快捷键失败信号是源码级断言**（确认框只在打开时挂载，
// SSR 看不到）——在 `pages/practice-pages.test.ts` 里（`.ts` 才能读文件：client 的 `.test.tsx` 会被
// typecheck，而 tsconfig 不含 @types/node）。
import type { ReactElement } from "react";
import { renderToString } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  AUTHOR_IDS,
  MAX_PRACTICE_STYLE_PACK_CHARS,
  resolveAuthor,
  type PracticeStylePack,
} from "@whispering233/ai-editor-shared";
import { AUTHOR_MISSING_HINT } from "../lib/workspace";
import StyleNotes, { StyleNotesBody } from "./StyleNotes";

// x-markdown 的 CJS lib 包内 require css，vitest node 直跑会 SyntaxError——mock 为纯文本渲染
vi.mock("@ant-design/x-markdown", () => ({
  default: ({ children }: { children?: string }) => children ?? null,
}));

const AUTHOR = resolveAuthor(AUTHOR_IDS[0]);
if (AUTHOR === null) throw new Error("预置作家清单为空：风格说明页无可渲染素材");
const AUTHOR_ID = AUTHOR.id;

/** SSR 归一：相邻文本节点之间的 `<!-- -->` + antd `Button` 对「两字中文」插入的空格（「保 存」→「保存」），
 * 否则「保存 / 取消 / 编辑 / 重试」这类双字按钮文案在断言里找不到 */
function renderHtml(node: ReactElement): string {
  return renderToString(node)
    .replace(/<!--[^>]*-->/g, "")
    .replace(/<span>([\u4e00-\u9fa5]) ([\u4e00-\u9fa5])<\/span>/g, "<span>$1$2</span>");
}

/** 含某文案的那个 button 元素（antd Button 的类型 / 可用性开关都在元素上） */
function buttonHtml(html: string, label: string): string {
  const index = html.indexOf(label);
  expect(index, label).toBeGreaterThan(0);
  return html.slice(html.lastIndexOf("<button", index), html.indexOf("</button>", index));
}

function pack(overrides: Partial<PracticeStylePack> = {}): PracticeStylePack {
  return {
    authorId: AUTHOR_ID,
    content: "# 江南风格说明\n\n长短句交替。",
    customized: false,
    updatedAt: null,
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof StyleNotesBody>[0]> = {}): string {
  return renderHtml(
    <StyleNotesBody
      author={AUTHOR}
      pack={pack()}
      loadError={null}
      onRetry={() => {}}
      editing={false}
      draft=""
      onDraftChange={() => {}}
      onStartEdit={() => {}}
      onCancelEdit={() => {}}
      saving={false}
      saveError={null}
      onSave={() => {}}
      onImportClick={() => {}}
      onResetClick={() => {}}
      {...overrides}
    />,
  );
}

describe("渲染态（生效内容 markdown 只读）", () => {
  it("生效内容进 card 面 markdown；页头右端组 = [编辑] [导入 .md]", () => {
    const html = render();
    expect(html).toContain("长短句交替。");
    expect(html).toContain("编辑");
    expect(html).toContain("导入 .md");
  });

  it("无用户覆盖 → 不出现 [恢复预置]、也不写「当前为自定义版本」", () => {
    const html = render();
    expect(html).not.toContain("恢复预置");
    expect(html).not.toContain("当前为自定义版本");
  });

  it("有用户覆盖 → 一行「当前为自定义版本」+ [恢复预置] 按钮", () => {
    const html = render({ pack: pack({ customized: true, updatedAt: "2026-10-01T10:00:00Z" }) });
    expect(html).toContain("当前为自定义版本");
    expect(html).toContain("恢复预置");
  });

  it("渲染态没有文本域（编辑入口是 [编辑]，不是就地可编）", () => {
    expect(render()).not.toContain("<textarea");
  });
});

describe("编辑态（md 源码 + 保存 / 取消）", () => {
  it("文本域带当前内容、上限取 shared 常量；[保存] 是主操作、[取消] 是次操作", () => {
    const html = render({ editing: true, draft: "# 我的版本" });
    expect(html).toContain("# 我的版本");
    expect(html).toContain(`maxLength="${MAX_PRACTICE_STYLE_PACK_CHARS}"`);
    const save = buttonHtml(html, "保存");
    expect(save).toContain("ant-btn-primary");
    expect(buttonHtml(html, "取消")).not.toContain("ant-btn-primary");
  });

  it("编辑态应用上限提示（数字由常量插值），不出现页头三按钮组", () => {
    const html = render({ editing: true, draft: "abc" });
    expect(html).toContain(`最多 ${MAX_PRACTICE_STYLE_PACK_CHARS} 字`);
    expect(html).not.toContain("导入 .md");
  });

  it("保存失败 → 编辑态内可见错误文案（不静默），且让位给错误行", () => {
    const html = render({ editing: true, draft: "abc", saveError: "风格说明不能为空" });
    expect(html).toContain("风格说明不能为空");
    expect(html).not.toContain(`最多 ${MAX_PRACTICE_STYLE_PACK_CHARS} 字`);
  });
});

describe("加载中 / 加载失败 / 作家未解析", () => {
  it("首帧（pack 为 null、无错）→ 骨架，不误报空态", () => {
    const html = render({ pack: null });
    expect(html).toContain("ant-skeleton");
    expect(html).not.toContain(AUTHOR_MISSING_HINT);
  });

  it("加载失败 → 错误文案 + [重试]", () => {
    const html = render({ pack: null, loadError: "加载失败，请重试" });
    expect(html).toContain("加载失败，请重试");
    expect(html).toContain("重试");
  });

  it("作家未解析 → 空态且**不给任何动作按钮**（端点必然 400）", () => {
    const html = render({ author: null, pack: null });
    expect(html).toContain(AUTHOR_MISSING_HINT);
    expect(html).not.toContain("导入 .md");
    expect(html).not.toContain("编辑");
  });
});

describe("页面骨架（容器）", () => {
  it("页头常驻模板 + 页头标题「作家风格说明」", () => {
    const html = renderHtml(<StyleNotes />);
    expect(html).toContain("flex h-full min-h-0 flex-col");
    expect(html).toContain("flex min-h-0 flex-1 flex-col overflow-y-auto");
    expect(html).toContain("作家风格说明");
  });

  it("store 未打开练习工作区（SSR 初始态）→ 空态，且不发请求", () => {
    const html = renderHtml(<StyleNotes />);
    expect(html).toContain(AUTHOR_MISSING_HINT);
  });
});
