"""
网关全局设置（如全局 Worker 认证）。
优先使用页面上保存的值，其次使用 .env 中的 WORKER_AUTH_*。
持久化：MYSQL_DATABASE 时用 MySQL settings 表，否则 Redis 或内存。
"""
from typing import Optional

from app.config import REDIS_URL, WORKER_AUTH_USERNAME, WORKER_AUTH_PASSWORD, use_mysql

_SETTINGS_KEY = "gateway:settings"
_runtime: dict = {}  # worker_auth_username, worker_auth_password


def _redis():
    if not REDIS_URL:
        return None
    import redis
    return redis.from_url(REDIS_URL, decode_responses=True)


def _mysql_get(k: str) -> Optional[str]:
    if not use_mysql():
        return None
    from app.db import fetchone
    row = fetchone("SELECT v FROM settings WHERE k = %s", (k,))
    return row["v"] if row and row.get("v") else None


def _mysql_set(k: str, v: Optional[str]) -> None:
    if not use_mysql():
        return
    from app.db import execute
    execute("INSERT INTO settings (k, v) VALUES (%s, %s) ON DUPLICATE KEY UPDATE v = %s", (k, v, v))


def _load_from_redis() -> None:
    r = _redis()
    if not r:
        return
    import json
    data = r.get(_SETTINGS_KEY)
    if data:
        try:
            _runtime.update(json.loads(data))
        except Exception:
            pass


def _save_to_redis() -> None:
    r = _redis()
    if not r:
        return
    import json
    r.set(_SETTINGS_KEY, json.dumps({k: v for k, v in _runtime.items() if v is not None}))


def get_global_worker_auth() -> Optional[tuple[str, str]]:
    """返回全局 Worker 认证 (username, password)。先读页面/MySQL/Redis 保存的，再读 env。"""
    if use_mysql():
        u = _mysql_get("worker_auth_username")
        p = _mysql_get("worker_auth_password")
        if u and p:
            return (u, p)
        if WORKER_AUTH_USERNAME and WORKER_AUTH_PASSWORD:
            return (WORKER_AUTH_USERNAME, WORKER_AUTH_PASSWORD)
        return None
    if not _runtime and _redis():
        _load_from_redis()
    u = _runtime.get("worker_auth_username")
    p = _runtime.get("worker_auth_password")
    if u and p:
        return (u, p)
    if WORKER_AUTH_USERNAME and WORKER_AUTH_PASSWORD:
        return (WORKER_AUTH_USERNAME, WORKER_AUTH_PASSWORD)
    return None


def set_global_worker_auth(username: Optional[str], password: Optional[str]) -> None:
    """设置全局 Worker 认证（页面上保存）。传 None 表示不修改该字段。"""
    if use_mysql():
        if username is not None:
            _mysql_set("worker_auth_username", username or None)
        if password is not None:
            _mysql_set("worker_auth_password", password or None)
        return
    if not _runtime and _redis():
        _load_from_redis()
    if username is not None:
        _runtime["worker_auth_username"] = username or None
    if password is not None:
        _runtime["worker_auth_password"] = password or None
    _save_to_redis()


def get_settings_for_api() -> dict:
    """供 GET /api/settings 使用，不返回密码明文。"""
    if use_mysql():
        u = _mysql_get("worker_auth_username") or WORKER_AUTH_USERNAME
        p = _mysql_get("worker_auth_password")
        has_password = bool(p or WORKER_AUTH_PASSWORD)
        return {"worker_auth_username": u, "worker_auth_has_password": has_password}
    if not _runtime and _redis():
        _load_from_redis()
    u = _runtime.get("worker_auth_username") or WORKER_AUTH_USERNAME
    if "worker_auth_password" in _runtime:
        has_password = bool(_runtime["worker_auth_password"])
    else:
        has_password = bool(WORKER_AUTH_PASSWORD)
    return {
        "worker_auth_username": u,
        "worker_auth_has_password": has_password,
    }
