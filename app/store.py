"""
prompt_id -> worker_id 映射存储。
gateway_job_id -> (prompt_id, worker_id) 映射（插队任务提交后）。
优先 MySQL（MYSQL_DATABASE）；否则 Redis（REDIS_URL）；否则内存。
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


def set_task_worker(prompt_id: str, worker_id: str) -> None:
    if use_mysql():
        _mysql_set_task_worker(prompt_id, worker_id)
        return
    if REDIS_URL:
        import redis
        import json
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.set("gateway:task:" + prompt_id, worker_id)
        return
    _memory[prompt_id] = worker_id


def get_task_worker(prompt_id: str) -> Optional[str]:
    if use_mysql():
        return _mysql_get_task_worker(prompt_id)
    if REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True)
        return r.get("gateway:task:" + prompt_id)
    return _memory.get(prompt_id)


def delete_task_worker(prompt_id: str) -> None:
    if use_mysql():
        from app.db import execute
        execute("DELETE FROM task_worker WHERE prompt_id = %s", (prompt_id,))
        return
    if REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.delete("gateway:task:" + prompt_id)
        return
    _memory.pop(prompt_id, None)


def set_gateway_job(gateway_job_id: str, prompt_id: str, worker_id: str) -> None:
    if use_mysql():
        _mysql_set_gateway_job(gateway_job_id, prompt_id, worker_id)
        return
    if REDIS_URL:
        import redis
        import json
        r = redis.from_url(REDIS_URL, decode_responses=True)
        r.set("gateway:job:" + gateway_job_id, json.dumps({"prompt_id": prompt_id, "worker_id": worker_id}))
        return
    _gateway_jobs[gateway_job_id] = {"prompt_id": prompt_id, "worker_id": worker_id}


def get_gateway_job(gateway_job_id: str) -> Optional[dict]:
    if use_mysql():
        return _mysql_get_gateway_job(gateway_job_id)
    if REDIS_URL:
        import redis
        import json
        r = redis.from_url(REDIS_URL, decode_responses=True)
        raw = r.get("gateway:job:" + gateway_job_id)
        return json.loads(raw) if raw else None
    return _gateway_jobs.get(gateway_job_id)
