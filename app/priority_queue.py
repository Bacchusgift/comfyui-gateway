"""
网关侧优先级队列：用于插队。数值越大越优先，同优先级先到先得。
与业务解耦：网关只认 priority 数值，由调用方决定（如 VIP=10，普通=0）。
Redis 不可用时自动降级到内存。
"""
import time
import uuid
import json
from typing import Any, Optional
from dataclasses import dataclass, asdict

from app.config import REDIS_URL, use_mysql

@dataclass
class QueuedJob:
    gateway_job_id: str
    prompt: dict
    client_id: str
    priority: int
    created_at: float

    def to_dict(self) -> dict:
        return {
            "gateway_job_id": self.gateway_job_id,
            "prompt": self.prompt,
            "client_id": self.client_id,
            "priority": self.priority,
            "created_at": self.created_at,
        }

    @classmethod
    def from_dict(cls, d: dict) -> "QueuedJob":
        ca = d.get("created_at")
        if hasattr(ca, "timestamp"):
            ca = ca.timestamp()
        elif not isinstance(ca, (int, float)):
            ca = time.time()
        return cls(
            gateway_job_id=d["gateway_job_id"],
            prompt=d["prompt"] if isinstance(d["prompt"], dict) else json.loads(d["prompt"]) if isinstance(d["prompt"], str) else {},
            client_id=d["client_id"],
            priority=int(d["priority"]),
            created_at=float(ca),
        )


_PENDING_KEY = "gateway:pending_queue"
_memory_list: list[dict] = []


def _redis():
    if not REDIS_URL:
        return None
    import redis
    return redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)


def _load_pending() -> list:
    try:
        r = _redis()
        if not r:
            return list(_memory_list)
        data = r.get(_PENDING_KEY)
        if not data:
            return []
        return json.loads(data)
    except Exception:
        return list(_memory_list)


def _save_pending(items: list) -> None:
    try:
        r = _redis()
        if not r:
            _memory_list.clear()
            _memory_list.extend(items)
            return
        r.set(_PENDING_KEY, json.dumps(items))
    except Exception:
        _memory_list.clear()
        _memory_list.extend(items)


def _mysql_add_job(job: QueuedJob) -> None:
    from app.db import execute, json_dumps
    execute(
        "INSERT INTO pending_queue (gateway_job_id, prompt, client_id, priority) VALUES (%s, %s, %s, %s)",
        (job.gateway_job_id, json_dumps(job.prompt), job.client_id, job.priority),
    )


def _mysql_pop_highest() -> Optional[QueuedJob]:
    from app.db import fetchone, execute
    row = fetchone("SELECT gateway_job_id, prompt, client_id, priority, created_at FROM pending_queue ORDER BY priority DESC, created_at ASC LIMIT 1")
    if not row:
        return None
    execute("DELETE FROM pending_queue WHERE gateway_job_id = %s", (row["gateway_job_id"],))
    return QueuedJob.from_dict(row)


def _mysql_get_job(gateway_job_id: str) -> Optional[QueuedJob]:
    from app.db import fetchone
    row = fetchone("SELECT gateway_job_id, prompt, client_id, priority, created_at FROM pending_queue WHERE gateway_job_id = %s", (gateway_job_id,))
    return QueuedJob.from_dict(row) if row else None


def _mysql_re_queue_job(job: QueuedJob) -> None:
    from app.db import execute, json_dumps
    execute(
        "INSERT INTO pending_queue (gateway_job_id, prompt, client_id, priority) VALUES (%s, %s, %s, %s)",
        (job.gateway_job_id, json_dumps(job.prompt), job.client_id, job.priority),
    )


def add_job(prompt: dict, client_id: str, priority: int = 0) -> QueuedJob:
    """加入待提交队列，返回 QueuedJob（含 gateway_job_id）。"""
    job = QueuedJob(
        gateway_job_id=str(uuid.uuid4()),
        prompt=prompt,
        client_id=client_id,
        priority=priority,
        created_at=time.time(),
    )
    if use_mysql():
        _mysql_add_job(job)
        return job
    items = _load_pending()
    items.append(job.to_dict())
    _save_pending(items)
    return job


def pop_highest() -> Optional[QueuedJob]:
    """取出优先级最高的一项（大优先，同优先先到先得）。"""
    if use_mysql():
        return _mysql_pop_highest()
    items = _load_pending()
    if not items:
        return None
    items.sort(key=lambda x: (-int(x["priority"]), float(x["created_at"])))
    top = items.pop(0)
    _save_pending(items)
    return QueuedJob.from_dict(top)


def get_job(gateway_job_id: str) -> Optional[QueuedJob]:
    """仅在 pending 列表中查找；已提交的需从 store.get_gateway_job 查。"""
    if use_mysql():
        return _mysql_get_job(gateway_job_id)
    items = _load_pending()
    for i, it in enumerate(items):
        if it.get("gateway_job_id") == gateway_job_id:
            return QueuedJob.from_dict(it)
    return None


def is_queued(gateway_job_id: str) -> bool:
    return get_job(gateway_job_id) is not None


def remove_job(gateway_job_id: str) -> bool:
    """从 pending 中移除并返回是否移除成功。"""
    if use_mysql():
        from app.db import execute
        execute("DELETE FROM pending_queue WHERE gateway_job_id = %s", (gateway_job_id,))
        return True
    items = _load_pending()
    for i, it in enumerate(items):
        if it.get("gateway_job_id") == gateway_job_id:
            items.pop(i)
            _save_pending(items)
            return True
    return False


def re_queue_job(job: QueuedJob) -> None:
    """将已 pop 的 job 重新放回队列，保持优先级顺序。"""
    if use_mysql():
        _mysql_re_queue_job(job)
        return
    items = _load_pending()
    items.append(job.to_dict())
    items.sort(key=lambda x: (-int(x["priority"]), float(x["created_at"])))
    _save_pending(items)
