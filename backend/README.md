# LLM Eval Platform — Backend

## 快速开始

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env   # 然后填写 LLM_GW_API_KEY（也可在前端 UI 里填写覆盖）
uvicorn app.main:app --reload --port 8000
```

- 健康检查：`GET http://localhost:8000/api/health`
- API 文档：`http://localhost:8000/docs`

## 关键环境变量

| Key | 说明 | 默认 |
|---|---|---|
| `LLM_GW_API_KEY` | 京东 LLM 网关密钥（前端 UI 可覆盖） | 无 |
| `LLM_GW_URL` | 网关地址（OpenAI Chat Completions 协议） | `http://llm-gw.jd.local/v1/chat/completions` |
| `EVAL_CONCURRENCY` | 单任务并发数 | 3 |
| `EVAL_MAX_ROWS` | 单文件最大行数 | 500 |
