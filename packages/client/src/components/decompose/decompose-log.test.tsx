// 拆解记录时间线 presenter SSR 走查（卡 22.4）：仓内无 jsdom，用 react-dom/server 直渲染 presenter
// （同 `decompose-dialog.test.tsx` / `section-card.test.tsx` 惯例）。
// 契约 = DESIGN.md §拆解小说「拆解记录时间线」：每行 = 时刻 + 单行文案 + 可选批徽标（`data-row` 行语言）；
// 空态 = `caption-text`「暂无过程记录」（会话被删后仍是空态）；拉取失败只降级成一行文案。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DecomposeJobLogRes } from "@whispering233/ai-editor-shared";
import { DecomposeLogSection } from "./decompose-log";
import { formatBackupTime } from "../../lib/backup";

const ENTRIES: DecomposeJobLogRes["entries"] = [
  { id: "e1", at: "2026-09-01T10:00:00.000Z", kind: "batch_start", text: "批 1 开始（3 章）", batchSeq: 1 },
  { id: "e2", at: "2026-09-01T10:01:00.000Z", kind: "merge_done", text: "归并完成：实体 12 / 关系 3" },
];

const noop = () => {};

describe("DecomposeLogSection", () => {
  it("展开态：每行 = 时刻 + 文案；带 batchSeq 的行多一枚批徽标，不带的不渲染", () => {
    const html = renderToString(<DecomposeLogSection entries={ENTRIES} expanded onToggle={noop} error={null} />);

    expect(html).toContain("拆解记录");
    expect(html).toContain(formatBackupTime(ENTRIES[0]!.at)); // 时刻复用备份列表的格式化
    expect(html).toContain("批 1 开始（3 章）");
    expect(html).toContain("归并完成：实体 12 / 关系 3");
    expect(html).toMatch(/第[\s\S]{0,12}1[\s\S]{0,12}批/); // 批徽标（TypeChip）；SSR 会在插值处插注释分隔符
    expect(html).toMatch(/收\s*起/); // antd 按钮在两字中文间插空格 ⇒ 不匹配字面量
    expect(html).not.toContain("暂无过程记录");
  });

  it("收起态：标题与「展开」按钮在，行不渲染（可折叠）", () => {
    const html = renderToString(
      <DecomposeLogSection entries={ENTRIES} expanded={false} onToggle={noop} error={null} />,
    );

    expect(html).toContain("拆解记录");
    expect(html).toMatch(/展\s*开/); // 同上：antd 按钮的两字中文被插了空格
    expect(html).not.toContain("批 1 开始（3 章）");
  });

  it("空态：一行 caption-text「暂无过程记录」（会话被删后仍渲染空态，不回 404）", () => {
    const html = renderToString(<DecomposeLogSection entries={[]} expanded={false} onToggle={noop} error={null} />);

    expect(html).toContain("暂无过程记录");
    expect(html).toContain("拆解记录");
  });

  it("拉取失败：一行错误文案（页面其余部分照常），不是空态也不是抛错", () => {
    const html = renderToString(
      <DecomposeLogSection entries={[]} expanded error="无法连接服务，请确认 ai-editor 服务已启动" onToggle={noop} />,
    );

    expect(html).toContain("无法连接服务，请确认 ai-editor 服务已启动");
    expect(html).not.toContain("暂无过程记录");
  });
});
