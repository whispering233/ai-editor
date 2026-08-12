# AI Editor 设计文档

按项目规范拆分到以下子目录：

| 目录 | 内容 | 阅读对象 |
|------|------|---------|
| [`design/`](./design/) | 系统架构设计：产品定位（`product.md`）、技术架构与分包（`architecture.md`）、关键决策 1-23（`decisions.md`）、迭代优化清单（`backlog.md`，MVP 不做） | 全体开发者 |
| [`api/`](./api/) | 核心 API 设计（端点契约 `endpoints.md`、AI 工具目录 `tools.md`、数据流 `data-flow.md`） | 前后端开发者 |
| [`database/`](./database/) | 数据结构 schema（表结构 `schema.md`、伏笔系统 `hooks.md`） | 后端开发者 |
| [`ui/`](./ui/) | 当前 UI 布局样式设计（`layout.md` 三栏工作台 + `pages/` 各页面细案，2026-08 已从原型更新为实现样式） | 前端开发者 |

**阅读顺序建议**：先 `design/product.md` 了解产品定位 → `design/architecture.md` 了解分包与依赖方向 → `design/decisions.md` 了解关键决策（尤其是决策 9-19 的数据模型与安全基线，20/21 为 SSE 断开检测与伏笔健康指标，22 为三栏工作台布局，23 为大纲节点结构化信息麦基字段集）→ 按职责阅读 `api/` 与 `database/`。

实现任何功能前先读对应文档，它们是单一事实来源（见仓库根目录 `AGENTS.md`）。
