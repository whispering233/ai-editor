// 根首页分区渲染守卫（卡 8）：两个分区、kind 感知的新建、当前工作区高亮、空分区引导文案。
//
// 为什么扫源码不 SSR：Dashboard 的数据来自 zustand store（SSR 走 getServerSnapshot 初始 state），
// 预置的小说 / 练习两个工作区在 renderToString 里不可见——分组与文案本身由
// `lib/workspace.test.ts` 覆盖，这里只钉住「页面确实用了那一份口径 + 结构不被改回去」。
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dashboard = readFileSync(new URL("./Dashboard.tsx", import.meta.url), "utf8");
const store = readFileSync(new URL("../stores/project.ts", import.meta.url), "utf8");
const route = readFileSync(new URL("../hooks/use-route.ts", import.meta.url), "utf8");
const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
const practicePage = readFileSync(new URL("./Practice.tsx", import.meta.url), "utf8");
const routeGuard = readFileSync(new URL("../lib/workspace-route-guard.ts", import.meta.url), "utf8");

describe("根首页分区（#/：小说 / 文风练习）", () => {
  it("分区口径只有一处：partitionWorkspaces（不按 kind 各写一遍 filter）", () => {
    expect(dashboard).toContain("partitionWorkspaces(bookshelf?.books ?? null)");
    expect(dashboard).not.toMatch(/kind === \"novel\"\s*\)/);
  });

  it("两个分区各带一行 section-title（标题取 WORKSPACE_SECTION_TITLE）", () => {
    expect(dashboard).toContain("{WORKSPACE_SECTION_TITLE.novel}");
    expect(dashboard).toContain("{WORKSPACE_SECTION_TITLE.practice}");
    expect(dashboard.match(/<Typography\.Title level=\{5\}>/g)).toHaveLength(2);
  });

  it("小说分区沿用原书架内容（行列表 + 新建 + 打开其他路径），练习分区是独立卡列表", () => {
    expect(dashboard).toContain("partitions.novel.map((book)");
    expect(dashboard).toContain("partitions.practice.map((workspace)");
    expect(dashboard).toContain("打开其他路径…");
  });

  it("当前工作区高亮仍按项目 id（两分区同一判据，不是按名字）", () => {
    expect(dashboard.match(/isCurrentBook\(/g)?.length).toBeGreaterThanOrEqual(3); // strip + 两分区行
    expect(dashboard).not.toMatch(/workspace\.name\s*===\s*config\??\.name/);
  });

  it("空分区给一行引导文案（练习空分区用 PRACTICE_EMPTY_HINT，不渲染空卡片）", () => {
    expect(dashboard).toContain("{PRACTICE_EMPTY_HINT}");
    expect(dashboard).toMatch(/partitions\.practice\.length > 0 \? \(/);
  });
});

describe("新建弹窗复用与 kind（不在练习分区另造第二套新建 UI）", () => {
  it("两分区共用同一份表单实现（renderCreateWorkspaceForm(kind, …)：一份定义 + 小说两处入口 + 练习一处）", () => {
    expect(dashboard.match(/renderCreateWorkspaceForm\(/g)).toHaveLength(4);
    expect(dashboard.match(/renderCreateWorkspaceForm\("novel"/g)).toHaveLength(2); // 列表底部 + 空列表主操作
    expect(dashboard.match(/renderCreateWorkspaceForm\("practice"/g)).toHaveLength(1);
  });

  it("目录名按 shared WORKSPACE_DIRS 拼（buildWorkspacePath(rootPath, kind, name)）", () => {
    expect(dashboard).toContain("buildWorkspacePath(bookshelf.rootPath, kind, name)");
    expect(store).toContain("WORKSPACE_DIRS[kind]");
    // 客户端不得再手写字面量目录名（注释里的路径示例不算）
    expect(store).not.toMatch(/\/books\/\$\{|[`'"]\/books\/[`'"]/);
    expect(store).not.toMatch(/[`'"]\/practice\/[`'"]/);
  });

  it("create 请求带 kind（落 project.json，服务端据此定工具集/提示词/导航）", () => {
    expect(dashboard).toContain("{ name, language: \"zh\", kind }");
  });

  it("创建成功后刷新列表；练习区不自动打开（不切当前工作区），小说侧保持创建即进入", () => {
    expect(dashboard).toContain("await loadBookshelf();");
    expect(dashboard).toContain("{ open: openAfterCreate }");
    expect(dashboard).toMatch(/openAfterCreate = kind === \"novel\"/);
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH[kind])");
    expect(store).toMatch(/if \(options\?\.open === false\) return;/);
  });
});

describe("练习工作区的入口落点（不开项目概览）", () => {
  it("根首页行 / 当前工作区条 / 首帧直达三处都取 WORKSPACE_ENTRY_PATH", () => {
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH[book.kind])");
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH[config.kind])");
    expect(dashboard).toContain("handleOpenBook(workspace.path, workspace.kind)");
  });

  it("practice 段进已知路由表，main.tsx 渲染练习占位页", () => {
    expect(route).toMatch(/"practice",\n\] as const;/);
    expect(main).toContain('case "practice":');
    expect(main).toContain("<Practice />");
  });

  it("工作区类型守卫在**渲染前**判定：被挡下的 hash 只渲染 RedirectTo，不挂载目标页面", () => {
    expect(main).toContain("workspaceRedirectPath(kind, route)");
    // 页面渲染器只有一处调用（另一处是它的定义）：放行分支渲染页面、被挡分支渲染 RedirectTo
    expect(main.match(/renderPage\(/g)).toHaveLength(2);
    expect(main).toContain("{redirect === null ? renderPage(route) : <RedirectTo to={redirect} />}");
    // 旧写法（挂载后 effect 补跳）不得回退：被挡下的页面会先打出对面工作区的请求（400）
    expect(main).not.toContain("useWorkspaceRouteGuard");
    expect(routeGuard).not.toContain("useEffect");
    expect(routeGuard).not.toMatch(/export function use[A-Z]/);
  });

  it("占位页不调练习业务端点（/practice 的调用归卡 9）", () => {
    expect(practicePage).not.toContain("../lib/api");
    expect(practicePage).not.toMatch(/practice\/(targets|samples)/);
    expect(practicePage).not.toContain("fetch(");
  });
});
