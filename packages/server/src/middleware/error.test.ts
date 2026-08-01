// 统一错误中间件测试（T6.1）：500 包裹格式 / HttpError 透传 / ok/fail 形状
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { errorHandler, fail, HttpError, ok } from "./error.js";

describe("ok / fail 帮助函数（endpoints.md 通用约定）", () => {
  it("ok 返回成功包裹", () => {
    expect(ok({ a: 1 })).toEqual({ success: true, data: { a: 1 } });
  });

  it("fail 返回错误包裹", () => {
    expect(fail("ENTITY_NOT_FOUND", "实体不存在")).toEqual({
      success: false,
      error: { code: "ENTITY_NOT_FOUND", message: "实体不存在" },
    });
  });
});

describe("errorHandler", () => {
  it("未处理异常 → 500 INTERNAL_ERROR 包裹", async () => {
    const app = new Hono();
    app.onError(errorHandler());
    app.get("/boom", () => {
      throw new Error("数据库连接失败");
    });
    const res = await app.request("http://127.0.0.1/boom");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "数据库连接失败" },
    });
  });

  it("HttpError → 按 status/code/message 透传", async () => {
    const app = new Hono();
    app.onError(errorHandler());
    app.get("/conflict", () => {
      throw new HttpError(409, "PROPOSAL_STALE", "快照不一致");
    });
    const res = await app.request("http://127.0.0.1/conflict");
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      success: false,
      error: { code: "PROPOSAL_STALE", message: "快照不一致" },
    });
  });

  it("正常路由不受影响（成功包裹直通）", async () => {
    const app = new Hono();
    app.onError(errorHandler());
    app.get("/ok", (c) => c.json(ok({ status: "ok" })));
    const res = await app.request("http://127.0.0.1/ok");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { status: "ok" } });
  });
});
