import os
from typing import Optional

def env(key: str, default: Optional[str] = None) -> Optional[str]:
    return os.environ.get(key, default)

# 可选：Redis 地址。不设置则使用内存存储（重启后 Worker 列表与任务映射会清空）。
# 示例: redis://localhost:6379/0
REDIS_URL: Optional[str] = env("REDIS_URL")

# 队列/负载缓存 TTL（秒）
QUEUE_CACHE_TTL_SECONDS: int = int(env("QUEUE_CACHE_TTL_SECONDS", "5") or "5")

# 请求 Worker 的超时（秒）
WORKER_REQUEST_TIMEOUT: float = float(env("WORKER_REQUEST_TIMEOUT", "30") or "30")

# 可选：所有 Worker 共用的反向代理（如 nginx）Basic 认证。未设置时仅使用各 Worker 单独配置的账密。
WORKER_AUTH_USERNAME: Optional[str] = env("WORKER_AUTH_USERNAME")
WORKER_AUTH_PASSWORD: Optional[str] = env("WORKER_AUTH_PASSWORD")

# 可选：MySQL 持久化。配置后 Worker、任务映射、插队队列、全局设置均写入 MySQL。
MYSQL_HOST: str = env("MYSQL_HOST") or "localhost"
MYSQL_PORT: int = int(env("MYSQL_PORT") or "3306")
MYSQL_USER: str = env("MYSQL_USER") or "root"
MYSQL_PASSWORD: str = env("MYSQL_PASSWORD") or ""
MYSQL_DATABASE: str = env("MYSQL_DATABASE") or "comfyui_gateway"

# 管理员账户配置（用于登录后台管理界面）
ADMIN_USERNAME: str = env("ADMIN_USERNAME") or "admin"
ADMIN_PASSWORD: str = env("ADMIN_PASSWORD") or "admin123"

# JWT 密钥（用于生成和验证 token）
JWT_SECRET: str = env("JWT_SECRET") or "your-secret-key-change-in-production"
JWT_EXPIRE_HOURS: int = int(env("JWT_EXPIRE_HOURS") or "24")

def use_mysql() -> bool:
    """是否启用 MySQL（配置了 MYSQL_DATABASE 时启用）。"""
    return bool(env("MYSQL_DATABASE"))
