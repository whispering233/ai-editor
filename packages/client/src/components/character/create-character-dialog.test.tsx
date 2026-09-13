// 新建人物弹窗渲染走查（卡片 3.5）
// 仓内无 jsdom/@testing-library（既有纪律：不引新依赖），用 react-dom/server renderToString 直渲染
// **内容体** `CreateCharacterFormBody`（弹窗外壳走 `createPortal`，SSR 不支持，见 `dialog.test.tsx` 同款边界）。
// 覆盖：三段结构（基础信息必填 / 可选字段 / 能力面板）→ 必填内联错误 → 重名软提示 →
//       面板三选（空白无二级下拉 / 模板计数 / 从角色复制提示）→ 提交错误 → 页脚两按钮。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { CreateCharacterFormBody } from "./create-character-dialog";
import type { CharacterCreateErrors, PanelChoice } from "../../lib/character-create";
import type { EntitySummary } from "@whispering233/ai-editor-shared";
import { panelFromTemplate } from "../../lib/character-create";

const NO_ERRORS: CharacterCreateErrors = { name: null, role: null, description: null };
const BASE_CHOICE: PanelChoice = { mode: "blank", templateId: "", sourceId: "" };

const CANDIDATES: EntitySummary[] = [
  {
    id: "char-9",
    type: "character",
    name: "王五",
    summary: { role: "反派" },
    createdAt: "2026-08-01T10:00:00Z",
    updatedAt: "2026-08-01T10:00:00Z",
  },
];

function render(overrides: Partial<Parameters<typeof CreateCharacterFormBody>[0]> = {}): string {
  return renderToString(
    <CreateCharacterFormBody
      name="张三"
      onNameChange={() => {}}
      values={{ role: "主角", description: "青云门弟子" }}
      onFieldChange={() => {}}
      errors={NO_ERRORS}
      duplicateName={null}
      panelChoice={BASE_CHOICE}
      onPanelChoiceChange={() => {}}
      copyCandidates={null}
      copyLoading={false}
      copyError={null}
      panel={[]}
      panelHint={null}
      submitting={false}
      submitError={null}
      onSubmit={() => {}}
      onCancel={() => {}}
      {...overrides}
    />,
  );
}

describe("CreateCharacterFormBody（新建人物弹窗内容体）", () => {
  it("三段结构齐全 + 必填/可选字段标签", () => {
    const html = render();
    for (const label of ["基础信息", "可选字段", "能力面板"]) {
      expect(html).toContain(label);
    }
    for (const label of ["姓名", "角色定位", "描述", "假名", "性别", "年龄", "种族", "动机", "性格"]) {
      expect(html).toContain(label);
    }
    expect(html).toContain('value="张三"');
  });

  it("必填缺失 → 三项内联错误同时渲染", () => {
    const html = render({
      name: "",
      errors: { name: "姓名不能为空", role: "角色定位不能为空", description: "描述不能为空" },
    });
    expect(html).toContain("姓名不能为空");
    expect(html).toContain("角色定位不能为空");
    expect(html).toContain("描述不能为空");
  });

  it("重名软提示渲染（并声明仍可创建）", () => {
    const html = render({ duplicateName: "张三" });
    // React SSR 在相邻文本/表达式之间插 `<!-- -->` 注释，故按片段断言
    expect(html).toContain("已有同名角色：");
    expect(html).toContain("张三");
    expect(html).toContain("仍可创建");
  });

  it("面板模式 = 空白：无二级下拉，计数文案为空白面板", () => {
    const html = render();
    expect(html).toContain('aria-label="能力面板来源"');
    expect(html).not.toContain('aria-label="内置模板"');
    expect(html).not.toContain('aria-label="源角色"');
    expect(html).toContain("空白面板：不创建任何字段");
  });

  it("面板模式 = 内置模板：渲染模板下拉与字段计数", () => {
    const panel = panelFromTemplate("numeric");
    const html = render({
      panelChoice: { mode: "template", templateId: "numeric", sourceId: "" },
      panel,
    });
    expect(html).toContain('aria-label="内置模板"');
    expect(html).toContain("将创建 3 个字段");
  });

  it("面板模式 = 从角色复制：渲染源角色下拉（候选带角色定位）", () => {
    const html = render({
      panelChoice: { mode: "copy", templateId: "", sourceId: "" },
      copyCandidates: CANDIDATES,
      panelHint: "请选择源角色",
    });
    expect(html).toContain('aria-label="源角色"');
    expect(html).toContain("请选择源角色");
  });

  it("复制读取失败 → 错误文案；提示位与错误位互斥渲染", () => {
    const html = render({
      panelChoice: { mode: "copy", templateId: "", sourceId: "char-9" },
      copyError: "无法读取该角色的能力面板，请重试",
      panelHint: "该角色没有能力面板结构",
    });
    expect(html).toContain("无法读取该角色的能力面板，请重试");
    expect(html).not.toContain("该角色没有能力面板结构");
  });

  it("源角色无可读面板 → 提示文案（非错误）", () => {
    const html = render({
      panelChoice: { mode: "copy", templateId: "", sourceId: "char-9" },
      panelHint: "该角色没有能力面板结构",
    });
    expect(html).toContain("该角色没有能力面板结构");
  });

  it("提交错误渲染 + 页脚两按钮", () => {
    const html = render({ submitError: "创建失败，请重试" });
    expect(html).toContain("创建失败，请重试");
    // antd 会给两个汉字的按钮文案插空格（autoInsertSpace）——按可含空格断言
    expect(html).toMatch(/取\s*消/);
    expect(html).toMatch(/创\s*建/);
    expect(html).toContain('type="submit"');
  });
});
