"""
Worker 注册与负载缓存。
持久化：MYSQL_DATABASE 时用 MySQL，否则 REDIS_URL 时用 Redis，否则仅内存。
负载信息：通过 GET /queue 拉取并缓存。
"""
import time
import uuid
from dataclasses import dataclass
from typing import Optional

from app.config import REDIS_URL, QUEUE_CACHE_TTL_SECONDS, use_mysql
from app.settings import get_global_worker_auth

@dataclass
class WorkerInfo:
    worker_id: str
    url: str
    name: Optional[str] = None
    weight: int = 1
    enabled: bool = True
    # 反向代理（如 nginx）Basic 认证：填后网关请求该 Worker 时会带 Authorization 头
    auth_username: Optional[str] = None
    auth_password: Optional[str] = None
    # 负载缓存（由 load_balancer / client 更新）
    queue_running: int = 0
    queue_pending: int = 0
    healthy: bool = True
    _cache_ts: float = 0

    def auth(self) -> Optional[tuple[str, str]]:
        """优先用本 Worker 的账密；未配置时使用全局认证（.env 或页面上配置）。"""
        if self.auth_username and self.auth_password:
            return (self.auth_username, self.auth_password)
        return get_global_worker_auth()

    def load_score(self) -> int:
        """队列负载：running + pending，用于最少队列策略。"""
        return self.queue_running + self.queue_pending

    def cache_valid(self) -> bool:
        return (time.time() - self._cache_ts) <= QUEUE_CACHE_TTL_SECONDS


# 内存中的 Worker 列表
_workers: dict[str, WorkerInfo] = {}
# 可选 Redis 持久化 Worker 列表
_WORKERS_KEY = "gateway:workers"
_WORKERS_IDS_KEY = "gateway:worker_ids"

def _redis():
    if not REDIS_URL:
        return None
    import redis
    return redis.from_url(REDIS_URL, decode_responses=True)

def _load_workers_from_mysql() -> None:
    if not use_mysql():
        return
    from app.db import fetchall
    rows = fetchall("SELECT worker_id, url, name, weight, enabled, auth_username, auth_password FROM workers")
    for r in rows:
        if not r:
            continue
        info = WorkerInfo(
            worker_id=r["worker_id"],
            url=r["url"],
            name=r.get("name"),
            weight=int(r.get("weight") or 1),
            enabled=bool(r.get("enabled", True)),
            auth_username=r.get("auth_username"),
            auth_password=r.get("auth_password"),
        )
        _workers[info.worker_id] = info


def _load_workers_from_redis() -> None:
    r = _redis()
    if not r:
        return
    data = r.get(_WORKERS_KEY)
    if not data:
        return
    import json
    try:
        arr = json.loads(data)
        for w in arr:
            info = WorkerInfo(
                worker_id=w["worker_id"],
                url=w["url"],
                name=w.get("name"),
                weight=w.get("weight", 1),
                enabled=w.get("enabled", True),
                auth_username=w.get("auth_username"),
                auth_password=w.get("auth_password"),
            )
            _workers[info.worker_id] = info
    except Exception:
        pass


def _persist_worker(w: WorkerInfo) -> None:
    if use_mysql():
        from app.db import execute
        execute(
            """INSERT INTO workers (worker_id, url, name, weight, enabled, auth_username, auth_password)
               VALUES (%s, %s, %s, %s, %s, %s, %s)
               ON DUPLICATE KEY UPDATE url=%s, name=%s, weight=%s, enabled=%s, auth_username=%s, auth_password=%s""",
            (w.worker_id, w.url, w.name, w.weight, 1 if w.enabled else 0, w.auth_username, w.auth_password,
             w.url, w.name, w.weight, 1 if w.enabled else 0, w.auth_username, w.auth_password),
        )
    if _redis():
        import json
        arr = [{"worker_id": x.worker_id, "url": x.url, "name": x.name, "weight": x.weight, "enabled": x.enabled,
                "auth_username": x.auth_username, "auth_password": x.auth_password} for x in _workers.values()]
        _redis().set(_WORKERS_KEY, json.dumps(arr))


def _delete_worker_persist(worker_id: str) -> None:
    if use_mysql():
        from app.db import execute
        execute("DELETE FROM workers WHERE worker_id = %s", (worker_id,))
    if _redis():
        import json
        arr = [{"worker_id": x.worker_id, "url": x.url, "name": x.name, "weight": x.weight, "enabled": x.enabled,
                "auth_username": x.auth_username, "auth_password": x.auth_password} for x in _workers.values()]
        _redis().set(_WORKERS_KEY, json.dumps(arr))


def list_workers() -> list[WorkerInfo]:
    if not _workers:
        if use_mysql():
            _load_workers_from_mysql()
        elif _redis():
            _load_workers_from_redis()
    return list(_workers.values())


def get_worker(worker_id: str) -> Optional[WorkerInfo]:
    if not _workers:
        if use_mysql():
            _load_workers_from_mysql()
        elif _redis():
            _load_workers_from_redis()
    return _workers.get(worker_id)


def add_worker(
    url: str,
    name: Optional[str] = None,
    weight: int = 1,
    auth_username: Optional[str] = None,
    auth_password: Optional[str] = None,
) -> WorkerInfo:
    worker_id = str(uuid.uuid4())
    url = url.rstrip("/")
    w = WorkerInfo(
        worker_id=worker_id,
        url=url,
        name=name or url,
        weight=weight,
        auth_username=auth_username,
        auth_password=auth_password,
    )
    _workers[worker_id] = w
    _persist_worker(w)
    return w


def update_worker(
    worker_id: str,
    name: Optional[str] = None,
    weight: Optional[int] = None,
    enabled: Optional[bool] = None,
    auth_username: Optional[str] = None,
    auth_password: Optional[str] = None,
) -> Optional[WorkerInfo]:
    w = _workers.get(worker_id)
    if not w:
        return None
    if name is not None:
        w.name = name
    if weight is not None:
        w.weight = weight
    if enabled is not None:
        w.enabled = enabled
    if auth_username is not None:
        w.auth_username = auth_username
    if auth_password is not None:
        w.auth_password = auth_password
    _persist_worker(w)
    return w


def remove_worker(worker_id: str) -> bool:
    if worker_id not in _workers:
        return False
    del _workers[worker_id]
    _delete_worker_persist(worker_id)
    return True

def update_worker_load(worker_id: str, queue_running: int, queue_pending: int, healthy: bool) -> None:
    w = _workers.get(worker_id)
    if not w:
        return
    w.queue_running = queue_running
    w.queue_pending = queue_pending
    w.healthy = healthy
    w._cache_ts = time.time()
