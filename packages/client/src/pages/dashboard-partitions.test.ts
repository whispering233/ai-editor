// 根首页分区渲染守卫（卡 8；卡 6 改版：练习分区 = 预置作家卡 + 懒创建）：两个分区、小说侧新建、
// 当前工作区高亮、练习卡列表与懒创建入口、五条练习路由的注册。
//
// 为什么扫源码不 SSR：Dashboard 的数据来自 zustand store（SSR 走 getServerSnapshot 初始 state），
// 预置的小说 / 练习两个工作区在 renderToString 里不可见——卡片合并 / 过滤 / 排序、状态行与懒创建载荷
// 本身由 `lib/workspace.test.ts` + `lib/workspace-route-guard.test.ts` 覆盖，
// 这里只钉住「页面确实用了那一份口径 + 结构不被改回去」。
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
    // 调用只有一处（第二处就是自己又分了一遍）
    expect(dashboard.match(/partitionWorkspaces\(/g)).toHaveLength(1);
    // 现值挑选的写法不得回归：练习分区不自己挑书，比较口径只用 `!==`（如 `config?.kind !== "practice"`）
    expect(dashboard).not.toContain('kind === "practice"');
    expect(dashboard).not.toMatch(/\.filter\([^)]{0,30}\.kind ===/);
  });

  it("两个分区各带一行 section-title（标题取 WORKSPACE_SECTION_TITLE）", () => {
    expect(dashboard).toContain("{WORKSPACE_SECTION_TITLE.novel}");
    expect(dashboard).toContain("{WORKSPACE_SECTION_TITLE.practice}");
    expect(dashboard.match(/<Typography\.Title level=\{5\}>/g)).toHaveLength(2);
  });

  it("小说分区沿用原书架内容（行列表 + 新建 + 打开其他路径）", () => {
    expect(dashboard).toContain("partitions.novel.map((book)");
    expect(dashboard).toContain("打开其他路径…");
  });

  it("当前工作区高亮仍按项目 id（两分区同一判据，不是按名字）", () => {
    expect(dashboard.match(/isCurrentBook\(/g)?.length).toBeGreaterThanOrEqual(3); // strip + 两分区行
    expect(dashboard).not.toMatch(/card\.author\.name\s*===\s*config\??\.name/);
  });
});

describe("小说分区的新建表单（练习分区没有新建入口）", () => {
  it("表单只有小说在用（一份定义 + 两处入口）；练习侧「新建练习区」入口与空态文案常量已删", () => {
    expect(dashboard.match(/renderCreateBookForm\(/g)).toHaveLength(3);
    expect(dashboard).not.toContain("renderCreateWorkspaceForm");
    expect(dashboard).not.toContain('"新建练习区"');
    expect(dashboard).not.toContain("PRACTICE_EMPTY_HINT");
  });

  it("目录名按 shared WORKSPACE_DIRS 拼（buildWorkspacePath(rootPath, kind, name)）", () => {
    expect(dashboard).toContain('buildWorkspacePath(bookshelf.rootPath, "novel", name)');
    expect(dashboard).toContain('buildWorkspacePath(bookshelf.rootPath, "practice", author.name)');
    expect(store).toContain("WORKSPACE_DIRS[kind]");
    // 客户端不得再手写字面量目录名（注释里的路径示例不算）
    expect(store).not.toMatch(/\/books\/\$\{|[`'"]\/books\/[`'"]/);
    expect(store).not.toMatch(/[`'"]\/practice\/[`'"]/);
  });

  it("小说 create 请求带 kind（落 project.json，服务端据此定工具集/提示词/导航）", () => {
    expect(dashboard).toMatch(/kind: "novel",/);
  });

  it("创建成功后刷新列表 + 创建即打开（小说侧行为不变）", () => {
    // 三句必须在**同一个函数里按序出现**：只断言「文件里出现过 await loadBookshelf();」是空断言
    //（文件内共四处），删掉新建路径里的那一处照样绿（卡 8 P2）。
    const create = dashboard.indexOf(
      'await createProjectAt(buildWorkspacePath(bookshelf.rootPath, "novel", name)',
    );
    const refresh = dashboard.indexOf("await loadBookshelf();", create);
    const enter = dashboard.indexOf("navigate(WORKSPACE_ENTRY_PATH.novel)", create);
    expect(create).toBeGreaterThan(-1);
    expect(refresh).toBeGreaterThan(create);
    expect(enter).toBeGreaterThan(refresh);
  });
});

describe("练习分区 = 预置作家卡（卡 6）", () => {
  it("卡片合并口径只有一处：practiceAuthorCards（未识别 authorId 的存量工作区不列出）", () => {
    expect(dashboard).toContain("practiceAuthorCards(bookshelf?.books ?? null)");
    expect(dashboard).toContain("practiceCards.map((card)");
    expect(dashboard).not.toContain("partitions.practice.map(");
  });

  it("卡 = 作家名 + 一行介绍摘录（截断）+ 状态行（practiceCardStatus）", () => {
    expect(dashboard).toContain("{card.author.name}");
    expect(dashboard).toContain("{card.author.intro}");
    expect(dashboard).toContain(
      "practiceCardStatus(card, isCurrent ? practiceSampleCount : null)",
    );
  });

  it("点未开始的卡 = 懒创建（名字 = 作家名 + kind = practice + author_id），建完即打开并落 #/practice", () => {
    expect(dashboard).toContain("if (card.workspace === null) void handleStartPractice(card.author);");
    expect(dashboard).toContain("name: author.name");
    expect(dashboard).toContain('kind: "practice"');
    expect(dashboard).toContain("author_id: author.id");
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH.practice)");
  });

  it("卡片禁点由 submitting 与书库未到共同决定（首帧不再点了没反应）；目录已存在（409）改直接打开", () => {
    expect(dashboard).toContain("disabled={submitting || bookshelf === null}");
    const start = dashboard.indexOf("async function handleStartPractice");
    const create = dashboard.indexOf("await createProjectAt(workspacePath, {", start);
    const open = dashboard.indexOf('await handleOpenBook(workspacePath, "practice");', start);
    const report = dashboard.indexOf("setBookOpenError(describeOpenError(openErrorCode(err)));", start);
    expect(create).toBeGreaterThan(start);
    expect(open).toBeGreaterThan(create); // 懒创建撞上已有目录 → 先直接打开，不报死路
    expect(report).toBeGreaterThan(open); // 其余错误才走行内提示
  });

  it("点已有的卡 = 打开（当前工作区直接落点，其余走 handleOpenBook）", () => {
    expect(dashboard).toContain("void handleOpenBook(card.workspace.path, card.workspace.kind)");
  });

  it("范文篇数只在「当前打开的那个练习工作区」上取（样本列表端点读的是当前工作区）", () => {
    expect(dashboard).toContain("getPracticeSamples()");
    expect(dashboard).toContain('config?.kind !== "practice"');
    expect(dashboard).toContain("setPracticeSampleCount(res.samples.length)");
  });
});

describe("练习工作区的入口落点（不开项目概览）", () => {
  it("根首页行 / 当前工作区条 / 首帧直达三处都取 WORKSPACE_ENTRY_PATH", () => {
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH[book.kind])");
    expect(dashboard).toContain("navigate(WORKSPACE_ENTRY_PATH[config.kind])");
    expect(dashboard).toContain("handleOpenBook(card.workspace.path, card.workspace.kind)");
  });

  it("练习工作区五段都进已知路由表，main.tsx 各自渲染对应页面", () => {
    for (const segment of ["author", "works", "style", "practice", "free"]) {
      expect(route, segment).toContain(`"${segment}",`);
      expect(main, segment).toContain(`case "${segment}":`);
    }
    expect(main).toContain("<AuthorIntro />");
    expect(main).toContain("<Works />");
    expect(main).toContain("<StyleNotes />");
    expect(main).toContain("<Practice />");
    expect(main).toContain("<Free />");
    expect(main).toContain("<PracticeDetail key={second} sampleId={second} />");
    expect(main).toContain("<FreeDetail key={second} pieceId={second} />");
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

  it("练习列表页走 lib/api 的封装（不自建 fetch；`/practice/*` 调用属卡 4，端点契约在 lib/api.ts）", () => {
    expect(practicePage).toContain('from "../lib/api"');
    expect(practicePage).not.toContain("fetch(");
  });
});
