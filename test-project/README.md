# 测试项目目录（借鉴 inkos 的 test-project 模式）

日常开发测试用：在此目录启动服务，项目文件（project.json / outline.json / data.db）由运行时生成，已被 `.gitignore` 全局忽略，**不入库**。

## 使用方式

```bash
# 方式一：生产态（构建后）
pnpm -r build
node packages/server/dist/index.js test-project
# → 浏览器自动打开 http://127.0.0.1:3456（127.0.0.1，决策 8）

# 方式二：打包安装（验证发布产物，见 backlog #8）
# pnpm pack 各包 → 测试目录 npm install → npx ai-editor test-project

# 方式三：dev 态
# pnpm dev（server 待命于 packages/server，不污染；前端 Dashboard 引导创建/打开项目）
```

启动后项目文件生成在本目录（不入库），停止服务后可随意删除重建。

## 注意

- 本项目文件属运行时数据，**不要手动提交**（gitignore 已忽略）
- 如需重置：停止服务后删除本目录下的 `project.json` / `outline.json` / `data.db*` 即可
