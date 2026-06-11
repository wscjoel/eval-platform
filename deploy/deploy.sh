#!/usr/bin/env bash
# 客服AI评测台 — 服务器端一键部署/更新脚本
#
# 用法（在服务器上执行）：
#   首次：git clone https://github.com/wscjoel/eval-platform.git /opt/eval-platform
#         cd /opt/eval-platform && bash deploy/deploy.sh
#   更新：cd /opt/eval-platform && bash deploy/deploy.sh
#
# 依赖：python3 (>=3.9)、node (>=18) + npm、git
# 前端构建产物会输出到 backend/app/static/（vite.config 已配置），
# FastAPI 直接托管，无需单独的前端服务。

set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="$APP_DIR/backend"
FRONTEND_DIR="$APP_DIR/frontend"

echo "==> 部署目录: $APP_DIR"

# 1. 拉取最新代码（已在 git 仓库内时）
if [ -d "$APP_DIR/.git" ]; then
  echo "==> git pull"
  git -C "$APP_DIR" pull --ff-only
fi

# 2. 后端依赖
echo "==> 安装后端依赖"
if [ ! -d "$BACKEND_DIR/.venv" ]; then
  python3 -m venv "$BACKEND_DIR/.venv"
fi
"$BACKEND_DIR/.venv/bin/pip" install -q --upgrade pip
"$BACKEND_DIR/.venv/bin/pip" install -q -r "$BACKEND_DIR/requirements.txt"

# 3. 生产环境配置
if [ ! -f "$BACKEND_DIR/.env" ]; then
  cp "$BACKEND_DIR/.env.example" "$BACKEND_DIR/.env"
  echo "!!  已从 .env.example 生成 $BACKEND_DIR/.env"
  echo "!!  请编辑该文件：填写 LLM_GW_API_KEY，并修改 ADMIN_PASSWORD（默认 admin123 不安全）"
fi

# 4. 前端构建（产物直接输出到 backend/app/static/）
echo "==> 构建前端"
cd "$FRONTEND_DIR"
if [ ! -d node_modules ]; then
  npm install --legacy-peer-deps
fi
npm run build

# 5. 重启服务（systemd 已配置时）
if systemctl list-unit-files 2>/dev/null | grep -q "^eval-platform.service"; then
  echo "==> 重启 systemd 服务"
  sudo systemctl restart eval-platform
  sleep 2
  systemctl --no-pager status eval-platform | head -5
else
  cat <<'EOF'

==> systemd 服务尚未安装，首次部署请执行：
    sudo cp deploy/eval-platform.service /etc/systemd/system/
    # 编辑该文件中的 User / WorkingDirectory / ExecStart 为实际路径
    sudo systemctl daemon-reload
    sudo systemctl enable --now eval-platform

==> Nginx 反向代理（可选但推荐）：
    sudo cp nginx.conf /etc/nginx/sites-available/eval-platform   # 修改 server_name
    sudo ln -s /etc/nginx/sites-available/eval-platform /etc/nginx/sites-enabled/
    sudo nginx -t && sudo systemctl reload nginx
EOF
fi

echo "==> 完成。健康检查: curl http://127.0.0.1:8000/api/health"
