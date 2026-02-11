#!/usr/bin/env bash
cd "$(dirname "$0")"

# 加载 .env（若存在）
if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

# 确保虚拟环境与依赖
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
.venv/bin/pip install -q -r requirements.txt

# 若无前端构建产物则构建
if [ ! -d frontend/dist ]; then
  echo "Building frontend..."
  (cd frontend && npm install -s && npm run build)
fi

PORT=${PORT:-8000}
echo "Starting gateway at http://0.0.0.0:$PORT"
exec .venv/bin/uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
