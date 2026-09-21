// 「从云端恢复」对话框的展示口径（卡 23.7）：行状态三分支 + 元信息文案 + 失败文案。
//
// 契约 = docs/ui/DESIGN.md §书架主页 `cloud-remote-books-dialog`、docs/api/100-api-cloud.md
//（GET /cloud/remote-books 字段、POST /cloud/import-book 错误码）。
// 纯函数落在 lib/ 的理由：框走 `createPortal`（node 无 document 即崩），分支与文案必须可单测
//（同 `components/shelf/book-delete-dialog.test.ts` 惯例）。
import { describe, expect, it } from "vitest";
import type { CloudBackupEntry, CloudRemoteBook } from "@whispering233/ai-editor-shared";
import {
  CLOUD_REMOTE_ROW_LABELS,
  cloudRemoteBookRowState,
  cloudRemoteBookTitle,
  describeCloudBookMeta,
  describeCloudImportError,
} from "./cloud-books";
import { formatBackupTime, formatBytes } from "./backup";

const HEAD: CloudBackupEntry = {
  fileName: "2026-09-20-auto-苹果本-人物3-设定5-章12.zip",
  createdAt: "2026-09-20T10:15:30.000Z",
  kind: "auto",
  device: "苹果本",
  stats: { characters: 3, settings: 5, chapters: 12 },
  size: 2048,
};

function book(over: Partial<CloudRemoteBook> = {}): CloudRemoteBook {
  return {
    dirName: "云端书-abc123",
    name: "云端书",
    projectId: "abc123",
    localExists: false,
    backups: [HEAD],
    ...over,
  };
}

describe("cloudRemoteBookRowState：三分支", () => {
  it("本机没有 + 有备份 → importable", () => {
    expect(cloudRemoteBookRowState(book())).toBe("importable");
  });

  it("本机已有同 id → already-local（服务端不静默覆盖）", () => {
    expect(cloudRemoteBookRowState(book({ localExists: true }))).toBe("already-local");
  });

  it("该目录一份可解析的备份都没有 → no-backup", () => {
    expect(cloudRemoteBookRowState(book({ backups: [] }))).toBe("no-backup");
  });

  it("本机已有且无备份：先说「本机已有」（那是唯一能做的事）", () => {
    expect(cloudRemoteBookRowState(book({ localExists: true, backups: [] }))).toBe("already-local");
  });

  it("置灰态文案单一来源：本机已有 / 无备份", () => {
    expect(CLOUD_REMOTE_ROW_LABELS["already-local"]).toBe("本机已有");
    expect(CLOUD_REMOTE_ROW_LABELS["no-backup"]).toBe("无备份");
  });
});

describe("cloudRemoteBookTitle：书名解析不出回退目录名", () => {
  it("有书名用书名", () => {
    expect(cloudRemoteBookTitle(book())).toBe("云端书");
  });

  it("回退命名 / 手工命名目录（name = null）→ 显示目录名，不是空行", () => {
    expect(cloudRemoteBookTitle(book({ name: null, dirName: "ai-editor-abc123" }))).toBe(
      "ai-editor-abc123",
    );
  });
});

describe("describeCloudBookMeta：最近备份时间 · 份数 · 大小", () => {
  it("时间复用备份列表同一格式化；份数 = 该目录可解析份数；大小 = 最近那份", () => {
    const two: CloudBackupEntry = { ...HEAD, fileName: "b.zip", size: 1024 };
    const meta = describeCloudBookMeta(book({ backups: [HEAD, two] }));
    expect(meta).toBe(`${formatBackupTime(HEAD.createdAt)} · 2 份 · ${formatBytes(HEAD.size)}`);
  });

  it("无备份 → null（行尾已是「无备份」，不复述）", () => {
    expect(describeCloudBookMeta(book({ backups: [] }))).toBeNull();
  });
});

describe("describeCloudImportError：失败文案", () => {
  it("CLOUD_NOT_CONFIGURED → 引导去设置页云端面板（框内另给「去设置页」入口）", () => {
    const text = describeCloudImportError("CLOUD_NOT_CONFIGURED", "未配置云端账号");
    expect(text).toContain("云端");
    expect(text).toContain("设置");
  });

  it("PROJECT_ALREADY_EXISTS → 打开后同步即可（不重复导入）", () => {
    expect(
      describeCloudImportError("PROJECT_ALREADY_EXISTS", "本机书架已有这本书（id: abc）"),
    ).toBe("本机已有这本书，打开后同步即可");
  });

  it("其余码透传服务端中文 message（坏包 / 目录不符 / 未来版本 / 502 三码的具体原因不能丢）", () => {
    const message = "云端目录与备份内容不是同一本书（目录名声明 id: a，备份包内 id: b）";
    expect(describeCloudImportError("VALIDATION_ERROR", message)).toBe(message);
    expect(describeCloudImportError("SCHEMA_VERSION_MISMATCH", "备份来自更高版本程序")).toBe(
      "备份来自更高版本程序",
    );
    expect(describeCloudImportError("CLOUD_UNREACHABLE", "云盘不可达")).toBe("云盘不可达");
  });

  it("网络层失败 → 连接引导；未知码且服务端 message 为空 → 兜底文案", () => {
    expect(describeCloudImportError("CLIENT_NETWORK_ERROR", "fetch failed")).toContain(
      "无法连接服务",
    );
    expect(describeCloudImportError(null, "")).toContain("从云端恢复失败");
  });
});
