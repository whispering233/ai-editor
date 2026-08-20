# 参考资料页（决策 36 + 决策 43 修订，批次十一）

> 位置：中栏 TabBar「时间轴」之后、「回收站」之前；路由 `#/references`（列表）、`#/references/:id`（详情）、`#/references/new/md`（新建 md 文档草稿态）、`#/references/new/link`（新建外源链接草稿态）。
> 契约来源：`doc/design/decisions.md` 决策 36（第 7 种实体类型 reference）+ 决策 43（两类承载：本地 md 文件 + 外源链接）、`doc/database/schema.md`（reference data 字段）、`doc/api/endpoints.md`（entity CRUD + scan 端点）、`doc/api/tools.md`（search_references / propose_create_reference）。

## 定位

参考资料 = 创作参考素材库，**两类承载（决策 43）**：

| 类 | data.kind | 存储 | 来源列显示 |
|----|-----------|------|-----------|
| 本地 md 文档 | `file` | 项目目录 `references/<标题>.md`（YAML frontmatter + markdown 正文，**文件 = 真相源**）；entities 表索引为派生镜像（content 镜像缓存） | 相对路径 `references/xxx.md`（文本，不可点击） |
| 外源链接 | `link` | 仅索引（entities 表，`url` 必填） | URL（可点击跳转，`target="_blank" rel="noopener noreferrer"`） |

存量无 kind 条目运行时兼容 = 按 link 类展示（`source` 自由文本，URL 可点击逻辑保留）；AI 可读取参考（search_references + get_entity 详情全文，**纯 DB 读取**）、可提案写入（propose_create_reference → link 类，决策 43）。

## 路由与 Tab 映射

| 路由 | 页面 | Tab 高亮 |
|------|------|---------|
| `#/references` | ReferenceList 列表页 | 参考资料 |
| `#/references/new/md` | ReferenceDetail 详情页（**草稿态**：未落盘，保存时标题必填 → POST 创建） | 参考资料 |
| `#/references/new/link` | ReferenceDetail 详情页（**草稿态**：URL 必填 → POST 创建） | 参考资料 |
| `#/references/:id` | ReferenceDetail 详情页（编辑态） | 参考资料 |

## 列表页 `#/references`（ReferenceList）

- 结构：固定区（标题 + 操作）+ 滚动区（筛选行 + 列表），仿时间轴 G1 滚动结构（header 恒固定、列表独立滚动）。
- 标题行：`h1`「参考资料」+ 右侧**两个按钮**：`+ 新建 md 文档`（跳 `#/references/new/md`）+ `+ 新建外源链接`（跳 `#/references/new/link`）（决策 43 分流，替代原单一「新建参考资料」）+ 「扫描」按钮（决策 43 N6：扫描重建索引，带 loading；无项目禁用）。
- 筛选行：分类 ▾ 下拉（全部分类/素材摘抄/灵感记录/写作理论/设定参考，单选枚举）+ 标签 ▾ 下拉（聚合现有 tags 集合 + 全部，复用决策 31 标签筛选管道 + N2 可搜索下拉模式）+ 搜索输入（关键词，标题命中）+ 分页。
- 列表：`divide-y divide-border rounded-lg border border-border`，行信息 = **[标题、分类徽标、标签徽标、来源]**（决策 43，无内容摘要、无更新时间）：
  - 第一行：标题（`font-medium`，**点击 = 行内编辑**，Enter 确认、Esc 取消——决策 37/38 模式）+ 分类徽标（小号 badge 按枚举色）+ 右侧删除按钮（Trash2，H3 直接平铺不收 ⋯）；
  - 第二行：标签徽标（tags 前 3 个）+ 来源（`text-xs text-muted-foreground`：file → 相对路径文本；link → URL `<a>` 可点击跳转）。
  - **双击行 = 进详情页** `#/references/:id`（决策 37/38 模式；行内编辑态下双击不触发）。
- 空态：三分支——无任何参考资料>「还没有参考资料，先新建一个 md 文档或外源链接」+ [新建 md 文档]/[新建外源链接]；分类/标签筛选无匹配>「该分类/标签下暂无参考资料」；搜索无匹配>「未找到匹配的参考资料」。
- **右键菜单（决策 40 复用，无改动）**：RowContextMenu——[注入会话上下文、建立关联]，focus/source 按行对象构造（focus_entity_type='reference'、source.type='reference'）。
- **扫描提示（决策 43 N6）**：打开项目时若检测到 references/ 下存在未索引或 mtime 不一致文件（scan dry-run 或轻量探测端点），列表页顶部展示提示条「检测到 N 个未同步的本地文档」+ [扫描] 按钮。
- 软删：行删除按钮直接执行 + toast（H2 语义「已移入回收站，可随时还原」）；file 类文件移入 `references/.trash/`（服务端联动）。

## 详情页 `#/references/:id`（ReferenceDetail，编辑态/草稿态共用）

> 编辑形态内嵌（无「阅读/编辑」切换）：**决策 43 详情页即编辑器**——列表页完整编辑入口收敛于此（B1 修复：列表 Dialog 编辑已移除）。

- 结构：面包屑（← 参考资料 / 当前标题）+ 内容区。
- **md 文档详情页（kind='file'）**：
  - 标题（`font-serif text-xl`，可编辑：点击进入 input，Enter 确认保存——保存只改 frontmatter title + 索引，**不重命名文件**）+ 分类 select + 标签编辑（复用 F8 TagSuggest：回车添加下一项、粘贴逗号分隔、快捷选择 chips、datalist 自动补全）+ **「导入 md 文档」按钮**（N4：文件选择 .md → FileReader 读文本 → 解析 frontmatter 预填标题/分类/标签 → 正文填入编辑器，纯前端无上传端点）+ **「建立关联」按钮**（CreateRelationDialog 复用，源端点预填当前 reference）+ 删除按钮（软删，一次性确认）。
  - **markdown 编辑器（N3）**：@uiw/react-md-editor（textarea + 分屏预览，`data-color-mode` 随 use-theme 联动；CSS 与 Tailwind 冲突处理见卡 11.5）；内容 = 索引 content 镜像（保存时 PUT data.content → 服务端先写文件再更新 DB）。
  - 保存：PUT（name + data{kind,type,tags,content}）；新建草稿态：标题必填 → POST 创建落盘 → 路由跳 `#/references/:id`。
- **外源链接详情页（kind='link'）**：标题（行内编辑同 md）+ **URL（必填，校验非空 + 格式建议 http(s)）** + 分类 select + 标签编辑 + 内容 textarea（可选备注/摘录）+ **建立关联按钮**（2026-08 用户补充：外源链接详情页同样需要）+ 删除按钮。
- 元信息：创建/更新时间保留（决策 39：列表不显示、详情保留）；file 类额外显示来源路径。
- 无参考实体/已软删：空态提示 + 返回列表；加载失败：错误态 + 重试；file 类文件缺失（外部删除，服务端 409 `REFERENCE_FILE_MISSING`）：提示先扫描同步。

## 与 AI 的集成入口（延续决策 35）

- 本页无页面内 AI 业务按钮（素材库，AI 读写走右栏聊天：search_references 查询 / propose_create_reference 提案确认，决策 43：AI 创建的条目归 link 类）。
- 详情页上报焦点（ui store `currentFocus`）——InfoBar「问 AI」带当前参考资料上下文（决策 35 入口模式）。

## 样式约定

- 全部走 token 类（`bg-card`/`border-border`/`text-muted-foreground` 等），禁硬编码色类（L 批次红线）。
- 分类徽标色：material（secondary）/ inspiration（accent）/ theory（primary）/ reference（muted）——文字标签区分，不用色块（色弱友好）。
- 编辑器深色联动：@uiw/react-md-editor `data-color-mode` 跟随 `ai-editor:theme`（use-theme），不引入编辑器自带主题变量硬编码。
