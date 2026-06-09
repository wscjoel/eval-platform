# 客服AI评测台

一个简洁的内网评测工具：上传 Excel → 写提示词 + JSON Schema → 自动调用京东 LLM 网关评测 → 查看/筛选结果 → 一键导出 Excel。

技术栈：FastAPI + SQLite + httpx + pandas / React + Vite + Tailwind + TanStack Query。

## 目录

```
eval-platform/
├── backend/   FastAPI 后端
└── frontend/  React 前端
```

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

```bash
cd frontend
npm install --legacy-peer-deps   # 仅首次
npm run dev                      # 打开 http://localhost:5173
```

Vite 已配置 `/api` 代理到 `http://localhost:8000`，无需手动配置 CORS。

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

登录权限、流式输出、多任务并发、断点续跑、A/B 模型对比、图表统计、Docker 部署。
