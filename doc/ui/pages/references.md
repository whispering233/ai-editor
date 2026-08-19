# 参考资料页（决策 36，批次九）

> 位置：中栏 TabBar「时间轴」之后、「回收站」之前；路由 `#/references`（列表）与 `#/references/:id`（详情）。
> 契约来源：`doc/design/decisions.md` 决策 36（第 7 种实体类型 reference）、`doc/database/schema.md`（reference data 字段）、`doc/api/tools.md`（search_references / propose_create_reference）。

## 定位

参考资料 = 创作参考素材库（外部素材摘抄 / 灵感记录 / 写作理论 / 设定参考），**非本书正文**（决策 24 边界）；AI 可读取参考（search_references + get_entity 详情全文）、可提案写入（propose_create_reference，用户确认后落地）。

## 路由与 Tab 映射

| 路由 | 页面 | Tab 高亮 |
|------|------|---------|
| `#/references` | ReferenceList 列表页 | 参考资料 |
| `#/references/:id` | ReferenceDetail 详情页 | 参考资料 |

TabBar 新增「参考资料」tab（数据源 `BookOpenText` 或 `Library` 图标，lucide），位置在时间轴后、回收站前。

## 列表页 `#/references`（ReferenceList）

- 结构：固定区（标题 + 操作）+ 滚动区（筛选行 + 列表），仿时间轴 G1 滚动结构（header 恒固定、列表独立滚动）。
- 标题行：`h1`「参考资料」+ 右侧「+ 新建参考资料」按钮（`Button` 主按钮）+ 无项目禁用。
- 筛选行：类型 ▾ 下拉（全部分类/素材摘抄/灵感记录/写作理论/设定参考，单选枚举）+ 标签 ▾ 下拉（聚合现有 tags 集合 + 全部，复用决策 31 标签筛选管道 + N2 可搜索下拉模式）+ 搜索输入（关键词，标题命中）+ 分页。
- 列表：`divide-y divide-border rounded-lg border border-border`，行含：类型徽标（小号 badge 按枚举色）、标题（`font-medium`，点击跳详情）、标签徽标（tags 前 3 个）、来源（`text-xs text-muted-foreground`，URL 显示为链接）、内容摘要截断 120 字（`text-sm text-muted-foreground`）、右侧操作（编辑 Pencil / 软删 Trash2，H3 直接平铺不收 ⋯）。
- 空态：三分支——无任何参考资料>「还没有参考资料，先新建一条」+ [新建]；类型/标签筛选无匹配>「该分类/标签下暂无参考资料」；搜索无匹配>「未找到匹配的参考资料」。
- 重建/编辑对话框：Dialog 表单——标题 Input + 类型 select（枚举单选）+ 内容 textarea（resize-y，全文编辑）+ 来源 Input（URL/书名/作者，可选）+ 标签编辑器（复用 F8 TagSuggest：回车添加下一项、粘贴逗号分隔、快捷选择 chips、datalist 自动补全）；字段校验：标题必填；违规内联错误提示。
- 新建成功：toast「已保存」+ 不自动跳详情（决策 31 J 批次语义）。

## 详情页 `#/references/:id`（ReferenceDetail）

- 结构：面包屑（参考资料 / 当前标题，复用 page-nav）+ 内容区。
- 内容：标题（`font-serif text-xl`）+ 类型徽标 + 标签徽标 + 来源链接（可点击跳转外链，`target="_blank" rel="noopener noreferrer"`）+ 创建/更新时间（`text-xs text-muted-foreground`）+ 全文正文（`whitespace-pre-wrap font-serif text-base leading-7` 宋体排版，长文滚动）。
- 操作：编辑（Dialog 同列表新建表单）、软删（一次性确认，决策 12 软删可还原）、跳转回列表。
- 无参考实体/已软删：空态提示 + 返回列表。
- 加载失败：错误态 + 重试。

## 与 AI 的集成入口（延续决策 35）

- 本页无页面内 AI 业务按钮（参考资料为素材库，AI 的读写均走右栏聊天：用户可提问「查找与五行相关的素材」→ LLM 调 search_references；或让 AI 总结对话要点保存为资料 → LLM 提案 propose_create_reference → 提案卡确认）
- 详情页可上报焦点（ui store `currentFocus`）——InfoBar「问 AI」点击时带当前参考资料上下文进入对话（决策 35 入口模式）。

## 样式约定

- 全部走 token 类（`bg-card`/`border-border`/`text-muted-foreground` 等），禁硬编码色类（L 批次红线）。
- 类型徽标色：material（secondary）/ inspiration（accent）/ theory（primary）/ reference（muted）——以文字标签区分即可，不用色块区分（色弱友好）。
- 长文正文与列表摘要区分：列表摘要截断 120 字（服务端返回摘要字段），详情返回全文（get_entity 完整 data）。