# 客服AI评测台

一个简洁的内网评测工具：上传 Excel → 写提示词 + JSON Schema → 自动调用京东 LLM 网关评测 → 查看/筛选结果 → 一键导出 Excel。

支持多账号：管理员在后台创建账号分发使用，每人只能看到自己的数据；管理后台可查看所有用户的评测数据与登录记录。

技术栈：FastAPI + SQLite + httpx + pandas / React + Vite + Tailwind + TanStack Query。

## 目录

```
eval-platform/
├── backend/   FastAPI 后端
├── frontend/  React 前端
└── deploy/    部署脚本与 systemd 服务文件
```

## 账号与权限

- 所有页面和 `/api/*` 接口均需登录（Cookie 会话，默认 7 天有效）。
- 首次启动自动创建管理员账号：用户名/密码来自环境变量 `ADMIN_USERNAME` / `ADMIN_PASSWORD`（默认 `admin` / `admin123`，**生产环境务必修改**）。
- 不开放注册；管理员在「管理后台 → 用户管理」创建账号发给使用者。
- 数据隔离：普通用户只能看到自己上传的数据集、评测任务和批注作业；管理员可见全部。
- 管理后台三个页面：
  - **数据总览**：每位用户的数据集/任务/批注作业数量与登录次数，点击行下钻明细
  - **用户管理**：创建账号、重置密码、启用/禁用、删除
  - **登录记录**：所有账号的登录历史（含失败尝试、IP、浏览器 UA）

## 启动

### 1. 后端

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env            # 可选：在 .env 中填写 LLM_GW_API_KEY
uvicorn app.main:app --reload --port 8000
```

- API 文档：<http://localhost:8000/docs>
- 健康检查：<http://localhost:8000/api/health>

### 2. 前端

开发模式（热更新，前后端分离端口）：

```bash
cd frontend
npm install --legacy-peer-deps   # 仅首次
npm run dev                      # 打开 http://localhost:5173
```

Vite 已配置 `/api` 代理到 `http://localhost:8000`，无需手动配置 CORS。

### 3. 生产部署（单服务）

为避免线上白屏（浏览器无法解析 TSX 源码），生产环境必须先把前端构建产物落到 `backend/app/static/`，由 FastAPI 同时托管前端与 API。

```bash
# 1) 构建前端，产物直接输出到 backend/app/static/
cd frontend
npm ci --legacy-peer-deps
npm run build

# 2) 启动后端（同时提供 /api 与 SPA 页面）
cd ../backend
source .venv/bin/activate
uvicorn app.main:app --host 0.0.0.0 --port 8000
```

构建后访问 `http://<host>:8000/` 即可看到页面：

- `/`、`/tasks/:id` 等 SPA 路由均回退到 `index.html`
- `/assets/*` 由 FastAPI 以正确 MIME 类型分发
- `/api/*` 路径下保留所有后端接口

> 部署到平台时务必把仓库根目录中的 `backend/app/static/` 产物提交入库（或在 CI/CD 中执行上述 `npm run build`），否则平台仅托管源码会再次白屏。

### 4. 内网服务器一键部署（systemd + Nginx）

服务器需预装 `python3 (>=3.9)`、`node (>=18)`、`git`。

```bash
# 首次
git clone https://github.com/wscjoel/eval-platform.git /opt/eval-platform
cd /opt/eval-platform
bash deploy/deploy.sh        # 安装依赖 + 构建前端 + 生成 .env

# 编辑生产配置：填 LLM_GW_API_KEY、改 ADMIN_PASSWORD
vim backend/.env

# 安装 systemd 服务（开机自启 + 崩溃自动拉起）
sudo cp deploy/eval-platform.service /etc/systemd/system/
# 按实际路径/用户修改文件里的 User / WorkingDirectory / ExecStart
sudo systemctl daemon-reload && sudo systemctl enable --now eval-platform

# Nginx 反向代理（修改 nginx.conf 里的 server_name 为内网域名/IP）
sudo cp nginx.conf /etc/nginx/sites-available/eval-platform
sudo ln -s /etc/nginx/sites-available/eval-platform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

之后更新版本只需：`cd /opt/eval-platform && bash deploy/deploy.sh`（自动 git pull + 重启服务）。

部署完成后把 `http://<内网域名或IP>/` 发给同事，用管理后台创建的账号登录即用。

## API Key 两种方式

- **环境变量**（推荐生产）：`export LLM_GW_API_KEY=xxx` 后端进程可见。
- **浏览器保存**（推荐本机）：顶部导航栏的 Key 输入框，保存到 `localStorage`，每次请求随任务一起发送给后端，**优先级高于环境变量**。

## 使用流程

1. 顶部输入并保存 API Key（或在后端设置环境变量）。
2. 点击「新建评测」→ 上传 `.xlsx / .xls / .csv`（≤5 MB，≤500 行）。
3. 选择模型（默认 `GPT-5.5-joybuilder`），写提示词模板，用 `{{列名}}` 引用任意 Excel 列，可点击右侧"可用列名"快速插入；已被引用的列名会高亮为绿色。可点「保存为模板」入提示词库，下次在「从模板库选用…」直接加载。
4. 编辑 JSON Schema 文本（描述字段含义即可），点「首行试运行」预览。
5. 「启动评测」→ 跳转任务详情，实时刷新进度。
6. 完成后筛选/展开行查看原始输出，失败行可单独「重试」；点「导出 Excel」下载合并结果文件。

## 评测调用约定

按京东 LLM 网关的 OpenAI Chat Completions 协议调用：

- URL: `http://llm-gw.jd.local/v1/chat/completions`
- Header: `Authorization: Bearer ${API_KEY}`
- Body: `{"model": ..., "messages": [{"role":"system","content":...}, {"role":"user","content":...}], "stream": false, "temperature": ...}`

`system` 提示词以 `system` 角色单独发送，用户提示词（含 JSON Schema）以 `user` 角色发送，要求模型只输出 JSON。响应解析 `choices[0].message.content`。

后端 `app/core/parser.py` 会依次尝试：整体 `json.loads` → 提取 ```json 代码块 → 提取首个 `{...}` 块；全部失败则标记 `parse_error`，原始输出保留供人工检查。

调用失败（HTTP 5xx 或网络异常）会自动指数退避重试 2 次（1s, 3s）。

## 关键 API

| Method | Path | 说明 |
|---|---|---|
| POST | `/api/auth/login` / `/api/auth/logout` | 登录 / 登出（HttpOnly Cookie 会话） |
| GET  | `/api/auth/me` | 当前登录用户 |
| POST | `/api/auth/change-password` | 修改自己的密码 |
| GET / POST | `/api/admin/users` | 用户列表 / 创建账号（仅管理员） |
| PUT / DELETE | `/api/admin/users/{id}` | 重置密码 / 启停用 / 删除（仅管理员） |
| GET  | `/api/admin/login-records` | 登录记录（仅管理员） |
| GET  | `/api/admin/overview` | 全员评测数据总览（仅管理员） |
| GET  | `/api/admin/users/{id}/data` | 某用户数据明细下钻（仅管理员） |
| POST | `/api/datasets` | 上传 Excel/CSV |
| GET  | `/api/datasets` / `/api/datasets/{id}` | 数据集列表 / 详情（含 10 行预览） |
| GET  | `/api/models` | 可选模型列表 |
| POST | `/api/tasks/trial` | 单行试运行（不入库） |
| POST | `/api/tasks` | 创建并后台启动评测任务 |
| GET  | `/api/tasks` / `/api/tasks/{id}` | 任务列表 / 详情（含进度） |
| GET  | `/api/tasks/{id}/results?status=&offset=&limit=` | 分页结果 + 动态字段列 |
| POST | `/api/tasks/{id}/retry/{row_index}` | 重试单行 |
| GET  | `/api/tasks/{id}/export.xlsx` | 下载结果（原始列 + `eval_*`） |
| DELETE | `/api/tasks/{id}` / `/api/datasets/{id}` | 删除 |
| GET / POST | `/api/prompts` | 提示词模板列表 / 新建 |
| GET / PUT / DELETE | `/api/prompts/{id}` | 提示词模板详情 / 更新 / 删除 |

所有任务、提示词模板、数据集元信息均落 SQLite (`backend/data/eval.db`)，重启不丢失。

## 设计系统

UI 风格遵循 ui-ux-pro-max 推荐的 **Minimal + Micro-interactions**：

- 字体：Inter (300-700)
- 主色 `#171717` / 次色 `#404040` / 强调金 `#D4AF37` / 背景 `#FFFFFF` / 状态色 `success #22C55E · danger #EF4444 · warning #F59E0B`
- 图标：自封装 SVG（无 emoji），统一线宽 1.75
- 全局 `cursor-pointer`、150ms transition、可见 focus ring、`prefers-reduced-motion` 自动降级
- 响应式：375 / 768 / 1024 / 1440 全部可用

## MVP 不做（已在 PRD 中声明）

流式输出、多任务并发、断点续跑、A/B 模型对比、图表统计、Docker 部署。（登录权限已于 v0.2 实现）
