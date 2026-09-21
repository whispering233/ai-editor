// `cloud-remote-books-dialog` presenter 渲染走查（卡 23.7）：仓内无 jsdom，用 react-dom/server
// 直渲染 presenter（容器 `CloudRemoteBooksDialog` 的拉取/导入副作用走浏览器手测）。
// 契约 = docs/ui/DESIGN.md §书架主页 `cloud-remote-books-dialog`：行 = 书名（回退目录名）+ 元信息 +
// 行尾状态（「本机已有」/「无备份」置灰、可导入给「导入」）；另有加载 / 空 / 失败三态。
// 注意：antd `Button` 会在两字中文之间插空格（「导 入」/「关 闭」）⇒ 这些断言用正则。
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CloudBackupEntry, CloudRemoteBook } from "@whispering233/ai-editor-shared";
import { CloudRemoteBooksView, type CloudRemoteBooksViewProps } from "./cloud-remote-books-dialog";
import { formatBackupTime } from "../../lib/backup";

const HEAD: CloudBackupEntry = {
  fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
  createdAt: "2026-09-20T10:15:30.000Z",
  kind: "auto",
  device: "苹果本",
  stats: { characters: 3, settings: 5, chapters: 12 },
  size: 2048,
};

const IMPORTABLE: CloudRemoteBook = {
  dirName: "云端书-abc123",
  name: "云端书",
  projectId: "abc123",
  localExists: false,
  backups: [HEAD],
};
const ALREADY_LOCAL: CloudRemoteBook = {
  dirName: "本机书-def456",
  name: "本机书",
  projectId: "def456",
  localExists: true,
  backups: [HEAD],
};
const NO_BACKUP: CloudRemoteBook = {
  dirName: "空目录-ghi789",
  name: "空目录",
  projectId: "ghi789",
  localExists: false,
  backups: [],
};
const FALLBACK_NAME: CloudRemoteBook = { ...IMPORTABLE, dirName: "ai-editor-abc123", name: null };

const noop = () => {};

/** 行块（`<li>` 块级提取）：逐行断言行尾形态，不受排版或文案里出现「导入」二字影响 */
function rowChunks(html: string): string[] {
  return [...html.matchAll(/<li[\s\S]*?<\/li>/g)].map((m) => m[0]);
}

function render(over: Partial<CloudRemoteBooksViewProps> = {}): string {
  return renderToString(
    <CloudRemoteBooksView
      books={[IMPORTABLE, ALREADY_LOCAL, NO_BACKUP, FALLBACK_NAME]}
      loadError={null}
      loadNotConfigured={false}
      importError={null}
      importingDir={null}
      onImport={noop}
      onRetry={noop}
      onOpenCloudSettings={noop}
      onClose={noop}
      {...over}
    />,
  );
}

describe("CloudRemoteBooksView 行列表（三分支行状态）", () => {
  const html = render();

  it("可导入行：给「导入」按钮（行尾），且只有它显示按钮文案", () => {
    const rows = rowChunks(html);
    expect(rows[0]).toContain("<span>导 入</span>");
    expect(rows[3]).toContain("<span>导 入</span>"); // 回退命名那份同样可导入
  });

  it("「本机已有」行：行尾中性徽标，不给「导入」按钮", () => {
    const rows = rowChunks(html);
    expect(rows[1]).toContain("本机已有");
    expect(rows[1]).not.toContain("<button");
  });

  it("无备份行：行尾「无备份」徽标 + 不给按钮（该目录不可导入）", () => {
    const rows = rowChunks(html);
    expect(rows[2]).toContain("无备份");
    expect(rows[2]).not.toContain("<button");
  });

  it("行 = 书名 + 元信息（最近备份时间 · 份数 · 大小）；name=null 回退目录名", () => {
    expect(html).toContain("云端书");
    expect(html).toContain("本机书");
    expect(html).toContain("空目录");
    expect(html).toContain("ai-editor-abc123"); // 回退命名 → 显示目录名，不是空标题
    expect(html).toContain(formatBackupTime(HEAD.createdAt));
    expect(html).toContain("1 份");
    expect(html).toContain("2 KB");
  });

  it("无备份行不渲染元信息行（行尾已是「无备份」，不复述）", () => {
    expect(rowChunks(html)[2]?.match(/<p /g)).toHaveLength(1); // 只有书名那行
  });

  it("导入在途：命中那份行内 loading、其余可导入行禁用（防连点）", () => {
    const rows = rowChunks(render({ importingDir: IMPORTABLE.dirName }));
    expect(rows[0]).toContain("ant-btn-loading");
    expect(rows[0]).toContain('disabled=""');
    expect(rows[3]).toContain('disabled=""'); // 另一枚「导入」按钮同时禁用
  });

  it("导入失败：框内一行错误文案（框不关——presenter 仍渲染行列表）", () => {
    const failed = render({ importError: "本机已有这本书，打开后同步即可" });
    expect(failed).toContain("本机已有这本书，打开后同步即可");
    expect(failed).toContain("云端书"); // 行列表没被错误态顶掉
  });
});

describe("CloudRemoteBooksView 加载 / 空 / 失败三态", () => {
  it("加载中（books = null）：一行加载文案，不渲染行列表", () => {
    const html = render({ books: null });
    expect(html).toContain("正在读取云端备份…");
    expect(html).not.toContain("云端书");
  });

  it("空态：一行「云端还没有可恢复的备份」", () => {
    const html = render({ books: [] });
    expect(html).toContain("云端还没有可恢复的备份");
  });

  it("失败态：错误文案 + 「重试」；非未配置时不给「去设置页」", () => {
    const html = render({ books: null, loadError: "云盘不可达" });
    expect(html).toContain("云盘不可达");
    expect(html).toMatch(/重\s*试/);
    expect(html).not.toContain("去设置页");
  });

  it("未配置云端（409 CLOUD_NOT_CONFIGURED）：给「去设置页」入口（复用跨页意图）", () => {
    const html = render({
      books: null,
      loadError: "还没有配置云端账号——去「设置 → 备份 → 云端备份」填好地址与账号再回来",
      loadNotConfigured: true,
    });
    expect(html).toContain("去设置页");
    expect(html).toMatch(/重\s*试/);
    expect(html).toContain("云端备份");
  });

  it("任何态都有「关闭」（受控框：presenter 不自持开合状态）", () => {
    expect(render()).toMatch(/关\s*闭/);
  });
});
