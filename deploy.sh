#!/usr/bin/env bash
# ComfyUI Gateway 一键 Docker 部署
set -e
cd "$(dirname "$0")"

# 检查 Docker
if ! command -v docker &>/dev/null; then
  echo "错误: 未检测到 Docker，请先安装 Docker 与 Docker Compose。"
  exit 1
fi
if ! docker compose version &>/dev/null && ! docker-compose version &>/dev/null; then
  echo "错误: 未检测到 docker compose，请安装 Docker Compose 插件或 docker-compose。"
  exit 1
fi

# 若无 .env 则从 env.example 复制
if [ ! -f .env ]; then
  echo "未找到 .env，已从 env.example 复制，请按需修改后重新运行。"
  cp env.example .env
  # 使用 compose 内 Redis 时默认写入
  if ! grep -q '^REDIS_URL=' .env 2>/dev/null; then
    echo "REDIS_URL=redis://redis:6379/0" >> .env
  fi
  echo "已创建 .env，请编辑后执行: ./deploy.sh"
  exit 0
fi

COMPOSE_CMD="docker compose"
if ! docker compose version &>/dev/null; then
  COMPOSE_CMD="docker-compose"
fi

echo "构建并启动容器..."
$COMPOSE_CMD build --no-cache
$COMPOSE_CMD up -d

PORT=${PORT:-8000}
echo ""
echo "部署完成。网关地址: http://localhost:$PORT"
echo "管理页: http://localhost:$PORT"
echo "API: http://localhost:$PORT/api/..."
echo ""
echo "常用命令:"
echo "  查看日志: $COMPOSE_CMD logs -f gateway"
echo "  停止:     $COMPOSE_CMD down"
echo "  重启:     $COMPOSE_CMD restart gateway"
