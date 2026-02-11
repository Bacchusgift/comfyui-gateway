"""
prompt_id -> worker_id 映射存储。
gateway_job_id -> (prompt_id, worker_id) 映射（插队任务提交后）。
优先 MySQL（MYSQL_DATABASE）；否则 Redis（REDIS_URL）；否则内存。
Redis 不可用时自动降级到内存，不会崩溃。
"""
from typing import Optional
from app.config import REDIS_URL, use_mysql


def _mysql_set_task_worker(prompt_id: str, worker_id: str) -> None:
    from app.db import execute
    execute(
        "INSERT INTO task_worker (prompt_id, worker_id) VALUES (%s, %s) ON DUPLICATE KEY UPDATE worker_id = %s",
        (prompt_id, worker_id, worker_id),
    )


def _mysql_get_task_worker(prompt_id: str) -> Optional[str]:
    from app.db import fetchone
    row = fetchone("SELECT worker_id FROM task_worker WHERE prompt_id = %s", (prompt_id,))
    return row["worker_id"] if row else None


def _mysql_set_gateway_job(gateway_job_id: str, prompt_id: str, worker_id: str) -> None:
    from app.db import execute
    execute(
        "INSERT INTO gateway_job (gateway_job_id, prompt_id, worker_id) VALUES (%s, %s, %s) ON DUPLICATE KEY UPDATE prompt_id=%s, worker_id=%s",
        (gateway_job_id, prompt_id, worker_id, prompt_id, worker_id),
    )


def _mysql_get_gateway_job(gateway_job_id: str) -> Optional[dict]:
    from app.db import fetchone
    row = fetchone("SELECT prompt_id, worker_id FROM gateway_job WHERE gateway_job_id = %s", (gateway_job_id,))
    return dict(row) if row else None


_memory: dict[str, str] = {}
_gateway_jobs: dict[str, dict] = {}


def _get_redis():
    if not REDIS_URL:
        return None
    import redis
    return redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=3, socket_timeout=3)


def set_task_worker(prompt_id: str, worker_id: str) -> None:
    if use_mysql():
        _mysql_set_task_worker(prompt_id, worker_id)
        return
    try:
        r = _get_redis()
        if r:
            r.set("gateway:task:" + prompt_id, worker_id)
            return
    except Exception:
        pass
    _memory[prompt_id] = worker_id


def get_task_worker(prompt_id: str) -> Optional[str]:
    if use_mysql():
        return _mysql_get_task_worker(prompt_id)
    try:
        r = _get_redis()
        if r:
            return r.get("gateway:task:" + prompt_id)
    except Exception:
        pass
    return _memory.get(prompt_id)


def delete_task_worker(prompt_id: str) -> None:
    if use_mysql():
        from app.db import execute
        execute("DELETE FROM task_worker WHERE prompt_id = %s", (prompt_id,))
        return
    try:
        r = _get_redis()
        if r:
            r.delete("gateway:task:" + prompt_id)
            return
    except Exception:
        pass
    _memory.pop(prompt_id, None)


def set_gateway_job(gateway_job_id: str, prompt_id: str, worker_id: str) -> None:
    if use_mysql():
        _mysql_set_gateway_job(gateway_job_id, prompt_id, worker_id)
        return
    try:
        r = _get_redis()
        if r:
            import json
            r.set("gateway:job:" + gateway_job_id, json.dumps({"prompt_id": prompt_id, "worker_id": worker_id}))
            return
    except Exception:
        pass
    _gateway_jobs[gateway_job_id] = {"prompt_id": prompt_id, "worker_id": worker_id}


def get_gateway_job(gateway_job_id: str) -> Optional[dict]:
    if use_mysql():
        return _mysql_get_gateway_job(gateway_job_id)
    try:
        r = _get_redis()
        if r:
            import json
            raw = r.get("gateway:job:" + gateway_job_id)
            return json.loads(raw) if raw else None
    except Exception:
        pass
    return _gateway_jobs.get(gateway_job_id)
