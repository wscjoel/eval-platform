#!/usr/bin/env bash
# 一键发布到 GitHub Pages：构建前端 → 把产物推到 gh-pages 分支。
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 构建前端"
(cd frontend && npm run build)

echo "==> 推送 backend/app/static 到 gh-pages 分支"
git add backend/app/static
git diff --cached --quiet backend/app/static || git commit -m "build: 更新前端构建产物" -- backend/app/static frontend 2>/dev/null || true

SPLIT=$(git subtree split --prefix backend/app/static HEAD)
git push origin "${SPLIT}:refs/heads/gh-pages" --force

echo "==> 完成。约 1 分钟后生效：https://wscjoel.github.io/eval-platform/"
