// 章视图 presenter 渲染走查（2026-09 大纲页双视图）：仓内无 jsdom，用 react-dom/server `renderToString`
// 直渲染展示层（数据与副作用在容器 `pages/Outline.tsx`）。
// 覆盖：两枚编号徽标 + 标题 + 摘要（卷号按行重复）/ 存量根级章无卷号 / 「阅读进度」徽标 /
//       伏笔标记 / 推演节点徽标（只读，D2）/ 「写正文」入口 + 正文字数（卡 12.5）/ 单击改名输入态 / 空态（有卷无章）。
import { describe, expect, it } from "vitest";
import { renderToString } from "react-dom/server";
import { buildDeductionMarks, type OutlineChapter } from "@whispering233/ai-editor-shared";
import { ChapterView, type ChapterViewHandlers } from "./chapter-view";
import type { OutlineChapterRow } from "../../lib/outline-tree";

const chapter = (
  id: string,
  title: string,
  summary?: string,
  /** 正文字数（卡 12.5；来自 GET /outline?with_metadata=true 的 metadata.textLength） */
  textLength?: number,
): OutlineChapter => ({
  id,
  type: "chapter",
  title,
  summary,
  updatedAt: "t",
  ...(textLength !== undefined ? { metadata: { textLength } } : {}),
});

/** 造行：卷1（第1章（带摘要）、第2章）、存量根级章（无卷号） */
const ROWS: OutlineChapterRow[] = [
  {
    chapter: chapter("ch-1", "雪夜出走", "主角离乡"),
    volumeId: "vol-1",
    volumeLabel: "第1卷",
    chapterLabel: "第1章",
  },
  {
    chapter: chapter("ch-2", "旧盟友", undefined, 1200),
    volumeId: "vol-1",
    volumeLabel: "第1卷",
    chapterLabel: "第2章",
  },
  {
    chapter: chapter("ch-9", "旧根级章"),
    volumeId: "root",
    volumeLabel: "",
    chapterLabel: "第3章",
  },
];

const NOOP: ChapterViewHandlers = {
  onStartEdit: () => {},
  onChangeEditingValue: () => {},
  onCommitEdit: () => {},
  onCancelEdit: () => {},
  onOpenDetail: () => {},
};

const html = (props: Partial<Parameters<typeof ChapterView>[0]> = {}): string =>
  renderToString(<ChapterView rows={ROWS} handlers={NOOP} {...props} />);

describe("ChapterView（章视图平铺列表）", () => {
  it("行 = 卷号 + 章号 + 标题 + 摘要；卷号按行重复（卷内每章都带）", () => {
    const out = html();
    expect(out).toContain("第1章");
    expect(out).toContain("第2章");
    expect(out).toContain("第3章");
    expect(out).toContain("雪夜出走");
    expect(out).toContain("主角离乡"); // 摘要
    expect(out.split("第1卷")).toHaveLength(3); // 卷1 的两行各带一次（split 段数 = 出现数 + 1）
    expect(out).toContain('data-node-id="ch-9"'); // 跨页定位锚点
    // 有意收窄（DESIGN「大纲页双视图」）：行内无任何操作**按钮**——删除/新建/拖拽都不在本视图
    // （「写正文」是图标按钮**链接**（antd `Button href` ⇒ `<a>`），不破这条收窄，见下一例）
    expect(out).not.toContain("<button");
    expect(out).not.toContain("移入回收站");
    expect(out).not.toContain("draggable");
  });

  it("存量根级章无卷号（不渲染空卷号徽标）", () => {
    const out = html({ rows: [ROWS[2]] });
    expect(out).toContain("第3章");
    expect(out).not.toContain("第1卷");
    expect(out).not.toContain("第2卷");
  });

  it("「阅读进度」徽标只出现在当前进度章行", () => {
    expect(html({ currentPositionId: "ch-2" }).split("阅读进度")).toHaveLength(2);
    expect(html({ currentPositionId: null })).not.toContain("阅读进度");
  });

  it("伏笔标记：按节点渲染徽标（埋设/推进/回收 + 伏笔名）", () => {
    const hookMarks = new Map([
      ["ch-1", [{ relationType: "plants" as const, hookId: "hk-1", hookName: "青铜钥匙" }]],
    ]);
    expect(html({ hookMarks })).toContain("埋设伏笔：青铜钥匙");
    expect(html({ hookMarks: null })).not.toContain("埋设伏笔");
  });

  it("「写正文」入口（卡 12.5 / 18.2）：每行一个 `EditOutlined` 图标按钮——antd `Button href` 渲染成 `<a>`，故仍是导航", () => {
    const out = html();
    expect(out).toContain('href="#/manuscript/ch-1"');
    expect(out).toContain('href="#/manuscript/ch-2"');
    expect(out).toContain('href="#/manuscript/ch-9"');
    expect(out.split('aria-label="写正文"')).toHaveLength(4); // 每行一个（split 段数 = 出现数 + 1）
    expect(out.split('title="写正文"')).toHaveLength(4);
    expect(out).not.toContain(">写正文<"); // 文案不再落可见文本（改由 title / aria-label 承载）
    expect(out.split('<a href="#/manuscript/')).toHaveLength(4); // 三个链接（段数 = 出现数 + 1）
    expect(out).toContain("ant-btn-variant-text"); // 走 icon-button 表皮（antd 的 text 变体）
  });

  it("正文字数（metadata.textLength）：> 0 显示文案，未写（0 / 无 metadata）不显示", () => {
    const out = html();
    expect(out).toContain("1.2 千字"); // ch-2 = 1200 字
    expect(out).not.toContain("0 字"); // 无 metadata 的章不落「0 字」占位
    expect(html({ rows: [ROWS[1]] })).toContain("1.2 千字");
    expect(html({ rows: [ROWS[0]] })).not.toContain("字"); // 无正文 → 整处文案不渲染
  });

  it("推演节点徽标：只读 chip，排在「阅读进度」左侧——不引入任何操作按钮", () => {
    const deductionMarks = buildDeductionMarks(
      { children: ROWS.map((row) => row.chapter) },
      ["ch-1"],
    );
    const out = html({ deductionMarks, currentPositionId: "ch-1" });
    expect(out).toContain('title="推演节点（第1章）"'); // 文案/章号来自 shared 派生
    expect(out).toContain(">推演节点<");
    expect(out.indexOf("推演节点（第1章）")).toBeLessThan(out.indexOf("阅读进度"));
    expect(out).not.toContain("<button"); // 收窄不变：本视图行内仍无操作按钮
    expect(html({ deductionMarks: [] })).not.toContain("推演节点");
  });

  it("改名态：该行渲染输入框（带当前值），标题不再是可点文本", () => {
    const out = html({ editing: { nodeId: "ch-2", value: "旧盟友·改" } });
    expect(out).toContain('value="旧盟友·改"');
    expect(out).toContain("雪夜出走"); // 其余行不受影响
  });

  it("空态（有卷无章）：给文案，不渲染列表容器", () => {
    const out = html({ rows: [] });
    expect(out).toContain("还没有章");
    expect(out).not.toContain("data-node-id");
  });
});
