// 码字统计路由（stats-1）：GET /api/v1/writing-stats（小说工作区专属**只读**端点）
//
// 契约单一来源：docs/api/130-api-writing-stats.md；表与不变式见 docs/db/schema.md「writing_stats_daily」。
// 口径：
// - `today` / `days[].date` = 服务端本地日（`local-date.ts`，写/读共用）；客户端不提交日期
// - `totalChars` / `totalDays` 由行集派生（不另建月表/年表）；`days` 只含有正增量的日期、按日升序
// - 无查询参数、无分页；统计的**唯一写入点** = PUT /manuscript 的派生副作用（本组只有读端点）
import { Hono } from "hono";
import { listWritingStats } from "@whispering233/ai-editor-db";
import type { WritingStatsRes } from "@whispering233/ai-editor-shared";
import { ok } from "../middleware/error.js";
import { requireCurrentProject } from "../middleware/project.js";
import { localDateKey } from "../local-date.js";

/** 码字统计路由（挂载于 /api/v1/writing-stats，index.ts） */
export const writingStatsRoutes = new Hono();

// GET /api/v1/writing-stats —— 当前小说的全部按天统计行（空库 → 0 / 0 / []，today 正常给）
writingStatsRoutes.get("/", (c) => {
  const project = requireCurrentProject();
  const days = listWritingStats(project.db);
  const body: WritingStatsRes = {
    today: localDateKey(),
    totalChars: days.reduce((sum, day) => sum + day.chars, 0),
    totalDays: days.length,
    days,
  };
  return c.json(ok(body));
});