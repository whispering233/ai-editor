// lib/book-name 书名校验测试（UX2 抽取：新建项目行内化后校验逻辑独立可测，创建/导入共用）
import { describe, expect, it } from "vitest";
import { validateBookName } from "./book-name";

describe("validateBookName（书名校验——防路径逃逸 + 非空）", () => {
  it("合法书名 → null（含首尾空白自动 trim）", () => {
    expect(validateBookName("我的小说")).toBeNull();
    expect(validateBookName("  修仙之路  ")).toBeNull();
  });

  it("空 / 纯空白 → 请输入书名", () => {
    expect(validateBookName("")).toBe("请输入书名");
    expect(validateBookName("   ")).toBe("请输入书名");
  });

  it("路径分隔符 / 或 \\ → 拒绝（buildBookPath 拼目录名，防逃出 books/）", () => {
    expect(validateBookName("a/b")).toBe("书名不能包含 /、\\ 或为 . / ..");
    expect(validateBookName("a\\b")).toBe("书名不能包含 /、\\ 或为 . / ..");
  });

  it("纯点段（. / .. / ...）→ 拒绝", () => {
    expect(validateBookName("..")).toBe("书名不能包含 /、\\ 或为 . / ..");
    expect(validateBookName("...")).toBe("书名不能包含 /、\\ 或为 . / ..");
  });

  it("控制字符（U+0000-U+001F）→ 拒绝", () => {
    expect(validateBookName("a\u0000b")).toBe("书名不能包含 /、\\ 或为 . / ..");
    expect(validateBookName("a\u001fb")).toBe("书名不能包含 /、\\ 或为 . / ..");
  });

  it("含分隔符但 trim 后不改变判断（前后空白不误判）", () => {
    expect(validateBookName(" 小说/续  ")).toBe("书名不能包含 /、\\ 或为 . / ..");
  });
});
