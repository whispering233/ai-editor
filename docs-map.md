# 设计文档地图（docs-map）

本文件是**设计文档的唯一索引与阅读顺序来源**。`AGENTS.md` 只放协作纪律与代码级硬约束，不重复这里的索引；新增 / 移动 / 重命名文档时同步改本文件。

## 阅读顺序

`docs/design/00-master-design.md`（产品定位与设计原则）→ `docs/design/architecture.md`（技术栈 / 分包与依赖方向 / pi 嵌入形态）→ 详细设计（`10-data-model.md` → `20-context.md` → `30-agent-loop.md`；按改动面再读 `40-cloud-sync.md` / `50-desktop.md` / `60-practice.md`）→ `docs/api/`（先 `00-api-index.md` + `api-public.md`）与 `docs/db/schema.md`（字段 / 端点「是什么」）→ 前端改动必读 `docs/ui/DESIGN.md`（视觉与布局唯一契约：改样式先改它）。

## 设计（`docs/design/`）

| 文件 | 内容 |
| :--- | :--- |
| `00-master-design.md` | 产品定位、设计原则、非目标（含「批量导入边界」声明） |
| `architecture.md` | 技术栈、分包与依赖方向、pi 嵌入形态、工作区类型与能力收窄 |
| `10-data-model.md` | 数据模型与存储：outline.json / project.json / `sessions/`、编号与章序口径、恢复覆盖语义、`computeState` |
| `20-context.md` | 上下文与提示词：分层注入、聚焦章、预算与分页常量 |
| `30-agent-loop.md` | Agent 循环与提案：工具派发、提案生命周期 |
| `40-cloud-sync.md` | 云端存档：WebDAV 协议与实测口径、状态机、冲突裁决、拉取语义 |
| `50-desktop.md` | 桌面版（Electron 外壳）：进程形态、打包、图标身份、安装器与卸载清理、自动更新 |
| `60-practice.md` | 作家文风练习（`kind = practice`）：预置作家、专属表、工具面收窄 |
| `build.md` | 运行、构建、打包、发布链路与验证命令 |
| `config.md` | 配置载体与读写边界 |
| `tasks.md` | 【临时】当前任务卡清单（完成后清空） |
| `backlog.md` | 未排期遗留项与有意口径 |

## API（`docs/api/`）

| 文件 | 内容 |
| :--- | :--- |
| `00-api-index.md` | 端点总索引（快速查找） |
| `api-public.md` | 公共请求 / 响应约定、公共头、错误包裹 |
| `error-code.md` | 错误码说明 |
| `10-api-project.md` | 项目 / 工作区、导入与导出（zip / 小说文档 / 纯文本） |
| `20-api-backup.md` | 备份、恢复、重命名（命名格式与统计段） |
| `30-api-entity.md` | 实体 CRUD |
| `40-api-relation.md` | 关系管理 |
| `50-api-delta.md` | Delta 变更追踪 |
| `60-api-outline.md` | 大纲操作 |
| `70-api-trash.md` | 回收站 |
| `80-api-chat.md` | AI 对话、SSE 帧集、提案确认、会话状态栏 |
| `90-api-settings.md` | 系统设置 |
| `100-api-cloud.md` | 云端存档端点（状态 / 推送 / 拉取 / 冲突 / 导入新书） |
| `110-api-manuscript.md` | 章正文（块文档）读写 |
| `120-api-practice.md` | 文风练习端点 |
| `130-api-writing-stats.md` | 码字统计（按天） |
| `tool-calling.md` | AI 工具目录、点名与分页常量、工具结果上限 |

## 数据与界面

| 文件 | 内容 |
| :--- | :--- |
| `docs/db/schema.md` | 表结构、outline.json / project.json 契约、自动备份目录命名 |
| `docs/ui/DESIGN.md` | 视觉与布局唯一契约：色 / 字号 / 圆角 / 间距、三栏与页头结构、antd token 登记表与守卫 |

## 状态与演进

- `CHANGELOG.md`（仓库根）：逐版本事实，发布正文来源。
- `docs/design/tasks.md`：当前任务卡（完成后清空，历史只留在 `CHANGELOG.md`）。
- `docs/design/backlog.md`：未排期遗留项与有意口径。
- `docs-map.md`（仓库根，本文件）：索引与阅读顺序。
