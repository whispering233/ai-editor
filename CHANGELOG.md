# Changelog

本文件记录项目的所有显著变动。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，
版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [Unreleased]

（开发中条目累积于此，发布时搬运为新版本段）

## [v0.0.3] - 2026-08-04

### Fixed

- npm 发布管道最终修复：npm 12 的 publish 在 postpack 恢复**之后**生成 registry manifest，prepack 替换只影响 tarball——改为发布前主动执行替换与 SPA 拷贝 + `npm publish --ignore-scripts`，manifest 与 tarball 一致；**0.0.3 是首个可正常安装的版本（0.0.1/0.0.2 manifest 残留 workspace:*，勿安装）**

## [v0.0.2] - 2026-08-04

### Fixed

- npm 发布管道修复：npm 12 的 `npm publish` 用 postpack 恢复后的 package.json 生成 registry manifest，导致 0.0.1 的 manifest 残留 `workspace:*`（`npm install` 报 EUNSUPPORTEDPROTOCOL）——改为发布前主动替换 workspace:* 后恢复；**0.0.1 已标注废弃，请使用 0.0.2**

### Changed

- 发布包名由 `@ai-editor/*` 改为 `@whispering233/ai-editor-*`（`@ai-editor` scope 在 npm 已被其他用户占用，无法发布）

## [v0.0.1] - 2026-08-04

首个正式发布（MVP 完整交付）。

### Added

- **项目管理**：书架模式（books/ 子目录，决策 8）、项目创建/打开/关闭/配置、启动待命语义（无项目不初始化）、LLM 设置（用户级配置，key 绝不入项目文件）
- **大纲**：严格三层（卷→章→场景）增删改移、行内就地编辑、拖拽排序（上下半判定）、节点详情页（麦基《故事》结构化字段：场景目标/冲突层次/价值转向、章反转/高潮场景、卷激励事件/幕高潮，决策 23）
- **实体与关系**：四类实体（人物/设定/地点/伏笔）CRUD、通用关系表 k 跳遍历、Delta 变更追踪与 computeState 状态计算（树路径父链累积，决策 9）
- **回收站**：软删/级联还原/purge 清理、restore 祖先链校验、启动一致性校验兜底（以大纲节点软删为准补标，决策 12/16）
- **画布**：大纲节点画布投影（自动布局/拖拽/缩放/仅场景模式）、布局持久化 localStorage（按项目隔离）、plot_edge 剧情连线创建与删除（标签 + 物理删确认）、节点伏笔标记（决策 10）
- **伏笔系统**：伏笔面板（活跃/已回收/已废弃分组、新建埋点、复合写确认、依赖链递归展开、软删级联）、大纲节点伏笔徽标（plants/advances/resolves，S9）
- **AI 对话链路**：DeepSeek SSE 流式客户端（手写解析/abort 三保险/截断防御）、44 个工具（查询 8/分析 5/伏笔 5/提案 14/执行 12）、agent 主循环三重保险（8 轮/120s/token）、提案确认流程（快照重校验/一次性消费/TTL）、chat SSE 路由（心跳 15-30s/三路断开检测/全链路取消，决策 20）
- **三栏工作台 UI**：左栏书架树（项目→会话二级树）、中栏信息条 + 6 tab、右栏常驻 ChatPanel（<1024px 折叠抽屉）、oklch 文学氛围双主题（暖羊皮纸/蓝黑曜石）、会话归属项目（决策 22）
- **全局反馈**：toast/错误横幅/确认对话框、应用级 ErrorBoundary 防白屏、数据变更自动刷新信号
- **数据备份（E1-E3）**：一键导出完整项目（zip 打包三文件 + WAL 完整快照）/ 从备份导入为新书（服务端校验 + 原子搬入，不覆盖现有书）——数据主权归用户
- **schema 安全（E4-E5）**：未来版本拒绝重建（PROJECT_VERSION_NEWER）、增量迁移机制（migrations/ 按序执行 + 迁移前时间戳快照 + 失败可续跑）
- **调试基础设施**：创作根 `.ai-editor/config.json` 五类别调试日志（chat/request/stream/usage/http）
- **打包安装**：6 包 tarball 安装链路（prepack 钩子：SPA 随包 + workspace:* 替换）、端到端冒烟测试（9 步链路）

### Changed

- UI 从「顶栏 + 侧栏 + 内容区」重构为三栏工作台（1:5:4，决策 22），`#/chat` 独立页移除——聊天常驻右栏
- 大纲交互重构（S13）：取消 ⋯ 操作条平铺图标化、拖拽上下半排序、摘要独立两行、移除回收站折叠区与移动到对话框
- 变更记录目标类型收紧——仅实体（历史数据保留展示）
- schema 演进策略：删库重建 → 增量迁移机制（v0.1.0 发布终止删库重建，决策 13/E5）
- 调试配置简化为纯配置文件（删除环境变量开关）
- 对话框宽度契约统一（基座 max-w-lg + 调用点覆盖）

### Fixed

- Base UI error #31 根因：DropdownMenuLabel 必须 DropdownMenuGroup 包裹（会话标题下拉整页白屏）
- DialogContent 基座宽度覆盖失效（sm:max-w-* 同特异性覆盖被压碎）
- 数据变更后页面不刷新（dataVersion 信号 + 全局刷新按钮）、刷新后会话不恢复（自动激活最近会话）
- 端口占用自动 +1 并打开实际端口（127.0.0.1，决策 8/17）
- 大纲同父重排 off-by-one（拖拽 order 剔除计算）、实体详情跨实体状态残留
- 启动相对路径创作根归一化（INVALID_PROJECT_PATH）

### Removed

- 游离节点（orphan_nodes）设计——大纲严格三层，无树外状态（决策 19）
- `#/chat` 独立页面（聊天常驻右栏）
- 大纲「移动到…」对话框（S13.1 平铺图标化替代）
- 调试环境变量开关（纯配置文件替代）
