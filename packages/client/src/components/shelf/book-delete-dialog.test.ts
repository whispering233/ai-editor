// `book-delete-dialog` 的 presenter 断言（卡 23.5）：框内文案 / 确认按钮分支 / 成功 toast 三口径。
//
// 为什么不 SSR 断言：client 无 jsdom，而本框走 `components/ui/dialog.tsx`（`createPortal(…, document.body)`）
// ——node 环境里没有 document，渲染即崩。故文案与分支收在可测的纯函数里（组件只负责摆放），
// 结构（书架行形态）另由 `pages/dashboard-shelf.test.ts` 扫源码守卫。
import { describe, expect, it } from "vitest";
import type { ProjectDeleteRes } from "@whispering233/ai-editor-shared";
import {
  BOOK_DELETE_CONSEQUENCES,
  BOOK_DELETE_REMOTE_DEFAULT,
  bookDeleteConfirmView,
  bookDeleteToast,
} from "./book-delete-dialog";

describe("book-delete-dialog 框内文案", () => {
  it("两行后果：本地目录含 .backups/ 一并删且不可恢复 / 删前推送云端", () => {
    expect(BOOK_DELETE_CONSEQUENCES).toHaveLength(2);
    const text = BOOK_DELETE_CONSEQUENCES.join("\n");
    expect(text).toContain(".backups/");
    expect(text).toContain("不可恢复");
    expect(text).toContain("推送到云端");
  });

  it("复选项「同时删除云端备份」默认不勾（云端那份是唯一不在本机的副本）", () => {
    expect(BOOK_DELETE_REMOTE_DEFAULT).toBe(false);
  });

  it("默认态：确认按钮 = [删除]（非 force），无附加提示", () => {
    expect(bookDeleteConfirmView(null)).toEqual({
      confirmLabel: "删除",
      force: false,
      note: null,
    });
  });

  it("推送失败态（含 409 CLOUD_CONFLICT）：确认按钮换 [仍要删除] + force，并写明最新改动不上云", () => {
    const view = bookDeleteConfirmView("云端已有更新的备份（x.zip）——本机未删除任何东西");
    expect(view.confirmLabel).toBe("仍要删除");
    expect(view.force).toBe(true);
    expect(view.note).toContain("最新改动不会上传云端");
  });
});

describe("book-delete-dialog 成功 toast（三口径）", () => {
  const base = { deleted: true as const, path: "/root/books/书1" };

  it("只删本机（未推云端）：一句话，不带云端口径", () => {
    const res: ProjectDeleteRes = { ...base };
    expect(bookDeleteToast(res, "书1")).toEqual({ text: "已删除《书1》", kind: "success" });
  });

  it("删前推送过一份：toast 带上 pushed.fileName", () => {
    const res: ProjectDeleteRes = { ...base, pushed: { fileName: "2026-09-21-auto-本机-人物1-设定2-章3.zip" } };
    const toast = bookDeleteToast(res, "书1");
    expect(toast.text).toContain("已删除《书1》");
    expect(toast.text).toContain(res.pushed.fileName);
    expect(toast.kind).toBe("success");
  });

  it("本地已删但云端保留（remoteError）：提示可去云盘网页手动清理，且不是纯成功口径", () => {
    const res: ProjectDeleteRes = {
      ...base,
      remoteError: { code: "CLOUD_UNREACHABLE", message: "云盘不可达" },
    };
    const toast = bookDeleteToast(res, "书1");
    expect(toast.text).toContain("云盘网页手动清理");
    expect(toast.text).toContain("云盘不可达");
    expect(toast.kind).toBe("error");
  });

  it("云端目录已删除：toast 明说云端也删了（不静默）", () => {
    const res: ProjectDeleteRes = { ...base, remoteDeleted: true };
    expect(bookDeleteToast(res, "书1").text).toContain("云端备份也已删除");
  });
});
