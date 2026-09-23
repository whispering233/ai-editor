// 书架「从云端恢复」入口守卫（卡 23.7）：入口是否还在、是否仍在书架页，就是这张卡的判据本身。
//
// 为什么扫源码不 SSR：Dashboard 的书架数据来自 zustand store，
// SSR 走 `getServerSnapshot`（初始 state），预置的书架在 `renderToString` 里不可见。
// 行状态三分支与框内形态另由 `lib/cloud-books.test.ts` 与
// `components/shelf/cloud-remote-books-dialog.test.tsx` 断言（presenter 走 react-dom/server）。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
const navRail = readFileSync(new URL("../components/nav/NavRail.tsx", import.meta.url), "utf8");

describe("书架「从云端恢复」入口（卡 23.7）", () => {
  it("「导入备份」旁并列一个「从云端恢复…」按钮（同一页头 action 行内）", () => {
    expect(dashboard).toContain("导入备份");
    expect(dashboard).toMatch(/从云端恢复…\s*<\/Button>/);
    // 并列：两个按钮在同一个 action 片段里（中间不再夹别的元素）
    expect(dashboard).toMatch(/导入备份\s*<\/Button>[\s\S]{0,400}?从云端恢复…/);
  });

  it("点击只开受控对话框（不新增一级导航）", () => {
    expect(dashboard).toMatch(/onClick=\{\(\) => setCloudRestoreOpen\(true\)\}/);
    expect(navRail).not.toContain("从云端恢复");
    expect(navRail).not.toContain("云端恢复");
  });

  it("对话框挂在书架页（受控：open = cloudRestoreOpen）", () => {
    expect(dashboard).toContain("<CloudRemoteBooksDialog");
    expect(dashboard).toMatch(/<CloudRemoteBooksDialog[\s\S]{0,120}?open=\{cloudRestoreOpen\}/);
  });

  it("导入成功只刷新书架（不自动打开新书：无跳转、无 openProjectAt）", () => {
    expect(dashboard).toMatch(/onImported=\{\(\) => void loadBookshelf\(\)\}/);
    expect(dashboard).not.toMatch(/<CloudRemoteBooksDialog[\s\S]{0,200}?navigate\(/);
  });
});
