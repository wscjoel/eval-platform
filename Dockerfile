# 客服AI评测台 — 生产镜像
#
# 前端构建产物（backend/app/static/）已提交入库，镜像内无需 Node，
# 只装 Python 依赖即可，构建快且不依赖 npm 源。
#
# 若行云无法拉取 Docker Hub 官方镜像，请把下面的基础镜像
# 替换为京东内部镜像仓库中的 python 3.9+ 镜像。

FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY backend/requirements.txt /app/requirements.txt
RUN pip install -r requirements.txt

COPY backend/app /app/app

# SQLite 与上传文件目录；线上请把持久化卷挂载到 /app/data
RUN mkdir -p /app/data
VOLUME ["/app/data"]

EXPOSE 8000

# 环境变量在行云应用配置中注入：
#   LLM_GW_API_KEY、ADMIN_USERNAME、ADMIN_PASSWORD、SECRET_KEY 等
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
