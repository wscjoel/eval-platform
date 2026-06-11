# 客服AI评测台（纯前端版）

一个**零后端**的评测工具网站：上传 Excel → 写提示词 + JSON Schema → 浏览器直连 LLM 网关评测 → 查看/筛选结果 → 一键导出 Excel。还内置数据清洗（JS 脚本）和人工批注。

**所有数据只保存在使用者自己的浏览器本地（IndexedDB / localStorage）**，不上传任何服务器：

- 数据集、提示词库、评测任务与结果、批注作业 → 浏览器 IndexedDB
- LLM 网关地址、模型列表、API Key → 浏览器 localStorage
- 评测请求由**浏览器直接发给 LLM 网关**，站点服务器（GitHub Pages）只发静态文件

技术栈：React + Vite + Tailwind + TanStack Query + Dexie (IndexedDB) + SheetJS。

## 在线访问

GitHub Pages 部署：

**<https://wscjoel.github.io/eval-platform/>**

> 注意：评测功能需要浏览器能访问 LLM 网关（如京东内网网关需在内网环境打开本站），且网关需允许跨域（CORS）。网关地址和模型列表可在顶部「设置」中修改。

## 使用说明

1. 打开网站，点顶部「设置」确认 LLM 网关地址和模型列表，填入 API Key（仅存本机）
2. 「数据集管理」上传 .xlsx / .xls / .csv
3. 「新建评测」选数据集 + 写提示词（支持 `{{列名}}` 占位符）+ 可选 JSON Schema → 试运行 → 全量运行
4. 「任务记录」查看进度与结果，可筛选、单行重试、导出 Excel
5. 「数据清洗」用 JavaScript 脚本批量清洗（浏览器 Web Worker 内运行，30s 超时）
6. 「人工批注」按模版对数据逐行批注并导出

数据在浏览器本地持久保存，刷新/关闭页面不丢失；但**清浏览器数据会一并清掉**，重要结果请及时导出 Excel。

## 本地开发

```bash
cd frontend
npm install --legacy-peer-deps   # 仅首次
npm run dev                      # http://localhost:5173
```

构建与冒烟测试：

```bash
cd frontend
npm run build        # 产物输出到 backend/app/static/
node smoke-test.mjs  # headless Chromium 跑核心流程
```

## 目录

```
eval-platform/
├── frontend/                  React 前端（含全部业务逻辑）
│   └── src/local/             浏览器本地实现：
│       ├── adapter.ts         axios 本地 adapter（原后端全部 /api/* 路由）
│       ├── db.ts              IndexedDB 数据层（Dexie）
│       ├── llm.ts             浏览器直连 LLM 网关 + JSON 稳健解析
│       ├── runner.ts          评测任务执行器（节流/重试/停止/单行重试）
│       ├── cleaningRunner.ts  清洗脚本 Web Worker 执行器
│       ├── excel.ts           Excel/CSV 解析与导出（SheetJS）
│       └── exports.ts         任务结果 / 批注作业导出
├── backend/                   旧版 FastAPI 后端（保留，纯前端版不再使用）
└── deploy/publish-pages.sh    一键发布到 GitHub Pages
```

## 部署

无需任何服务器。改完代码后执行：

```bash
./deploy/publish-pages.sh
```

脚本会构建前端，并把产物推送到 `gh-pages` 分支，GitHub Pages 自动生效（约 1 分钟）。
如果你的 git 凭证有 `workflow` 权限，也可改用 `deploy/github-pages-workflow.yml.example` 走 Actions 自动部署。

## 历史说明

仓库内保留了早期的 FastAPI 后端（含账号体系/管理后台/服务器存储），纯前端版已不再使用它。如需回到服务器集中存储模式，可参考 git 历史中的 README。
