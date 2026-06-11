# 客服AI评测台 — 多阶段构建：前端 Vite 构建 → FastAPI 单服务托管
#
# 本地验证：
#   docker build -t eval-platform .
#   docker run -p 8000:8000 -e ADMIN_PASSWORD=changeme eval-platform
#
# PaaS（Railway / Render / Zeabur 等）会自动识别本文件。
# 持久化：把卷挂载到 /data（已通过 DATA_DIR 环境变量指向）。

# ---------- 阶段 1：构建前端 ----------
FROM node:20-alpine AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm install --legacy-peer-deps
COPY frontend/ ./
# vite.config 输出到 ../backend/app/static
RUN mkdir -p /build/backend/app && npm run build

# ---------- 阶段 2：运行后端 ----------
FROM python:3.11-slim
WORKDIR /app

COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/app ./app
# 覆盖为刚构建的前端产物
COPY --from=frontend /build/backend/app/static ./app/static

# 数据目录：SQLite + 上传文件，挂载持久化卷到 /data
ENV DATA_DIR=/data
RUN mkdir -p /data

EXPOSE 8000
# PaaS 通常通过 $PORT 注入端口
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
