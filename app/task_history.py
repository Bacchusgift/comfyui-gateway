"""
任务历史表：记录所有任务的完整生命周期。

状态流转：
pending -> submitted -> running -> done/failed

字段说明：
- task_id: 主键，使用 gateway_job_id
- prompt_id: Worker 返回的执行 ID
- worker_id: 分配的 Worker
- status: 任务状态
- progress: 执行进度 0-100
- error_message: 错误信息
- submitted_at: 提交时间
- started_at: 开始执行时间
- completed_at: 完成时间
- result_json: 执行结果（Worker history）
"""
from datetime import datetime
from typing import Optional
from app.config import use_mysql

# ==================== 数据库操作 ====================

def _mysql_create_table() -> None:
    from app.db import execute
    execute("""
        CREATE TABLE IF NOT EXISTS task_history (
            task_id VARCHAR(64) PRIMARY KEY,
            prompt_id VARCHAR(64),
            worker_id VARCHAR(64),
            priority INT DEFAULT 0,
            status VARCHAR(32) DEFAULT 'pending',
            progress INT DEFAULT 0,
            error_message TEXT,
            submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            started_at TIMESTAMP NULL,
            completed_at TIMESTAMP NULL,
            result_json LONGTEXT,
            INDEX idx_status (status),
            INDEX idx_worker (worker_id),
            INDEX idx_submitted (submitted_at)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    """)


def _mysql_insert(task_id: str, prompt_id: Optional[str], worker_id: Optional[str],
                priority: int, status: str, progress: int = 0,
                error_message: Optional[str] = None,
                submitted_at: Optional[datetime] = None,
                started_at: Optional[datetime] = None,
                completed_at: Optional[datetime] = None,
                result_json: Optional[str] = None) -> None:
    from app.db import execute, json_dumps
    execute("""
        INSERT INTO task_history
            (task_id, prompt_id, worker_id, priority, status, progress,
             error_message, submitted_at, started_at, completed_at, result_json)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """, (task_id, prompt_id, worker_id, priority, status, progress,
              error_message, submitted_at, started_at, completed_at, json_dumps(result_json)))


def _mysql_update_status(task_id: str, status: str, progress: int = None,
                     started_at: Optional[datetime] = None,
                     completed_at: Optional[datetime] = None) -> None:
    from app.db import execute
    sql = "UPDATE task_history SET status = %s"
    params = [status]

    if progress is not None:
        sql += ", progress = %s"
        params.append(progress)

    if started_at is not None:
        sql += ", started_at = %s"
        params.append(started_at)

    if completed_at is not None:
        sql += ", completed_at = %s"
        params.append(completed_at)

    sql += " WHERE task_id = %s"
    params.append(task_id)

    execute(sql, params)


def _mysql_update_result(task_id: str, result_json: str, completed_at: datetime) -> None:
    from app.db import execute, json_dumps
    execute("UPDATE task_history SET result_json = %s, completed_at = %s WHERE task_id = %s",
            (json_dumps(result_json), completed_at, task_id))


def _mysql_update_error(task_id: str, error_message: str, completed_at: datetime) -> None:
    from app.db import execute
    execute("UPDATE task_history SET status = 'failed', error_message = %s, completed_at = %s WHERE task_id = %s",
            (error_message, completed_at, task_id))


def _mysql_list(limit: int = 100, offset: int = 0, worker_id: Optional[str] = None,
                status: Optional[str] = None) -> list:
    from app.db import fetchall
    sql = "SELECT * FROM task_history"
    params = []

    where_clauses = []
    if worker_id:
        where_clauses.append("worker_id = %s")
        params.append(worker_id)
    if status:
        where_clauses.append("status = %s")
        params.append(status)

    if where_clauses:
        sql += " WHERE " + " AND ".join(where_clauses)
        sql += f" ORDER BY submitted_at DESC LIMIT {limit} OFFSET {offset}"
    else:
        sql += f" ORDER BY submitted_at DESC LIMIT {limit} OFFSET {offset}"

    return fetchall(sql, params)


def _mysql_get_by_prompt_id(prompt_id: str) -> Optional[dict]:
    from app.db import fetchone
    row = fetchone("SELECT * FROM task_history WHERE prompt_id = %s ORDER BY submitted_at DESC LIMIT 1", (prompt_id,))
    return dict(row) if row else None


def _mysql_get_by_task_id(task_id: str) -> Optional[dict]:
    from app.db import fetchone
    row = fetchone("SELECT * FROM task_history WHERE task_id = %s", (task_id,))
    return dict(row) if row else None


# ==================== Redis/内存操作 ====================

_redis_list: list[dict] = []


def _redis_load() -> list:
    if use_mysql():
        return []

    global _redis_list
    return list(_redis_list)


def _redis_save(items: list) -> None:
    if use_mysql():
        return

    global _redis_list
    _redis_list.clear()
    _redis_list.extend(items)


def create_task(task_id: str, priority: int = 0) -> None:
    """创建新任务记录（pending 状态）。"""
    record = {
        "task_id": task_id,
        "prompt_id": None,
        "worker_id": None,
        "priority": priority,
        "status": "pending",
        "progress": 0,
        "error_message": None,
        "submitted_at": datetime.now().isoformat(),
        "started_at": None,
        "completed_at": None,
        "result_json": None
    }

    if use_mysql():
        _mysql_insert(
            task_id=task_id,
            prompt_id=None,
            worker_id=None,
            priority=priority,
            status="pending",
            submitted_at=datetime.now()
        )
    else:
        items = _redis_load()
        items.append(record)
        _redis_save(items)


def update_submitted(task_id: str, prompt_id: str, worker_id: str) -> None:
    """任务已提交到 Worker（submitted -> running）。"""
    if use_mysql():
        _mysql_update_status(task_id, status="running", started_at=datetime.now())
    else:
        items = _redis_load()
        for i, item in enumerate(items):
            if item.get("task_id") == task_id:
                items[i]["status"] = "running"
                items[i]["prompt_id"] = prompt_id
                items[i]["worker_id"] = worker_id
                items[i]["started_at"] = datetime.now().isoformat()
                break
        _redis_save(items)


def update_progress(task_id: str, progress: int) -> None:
    """更新任务进度。"""
    if use_mysql():
        _mysql_update_status(task_id, progress=progress)
    else:
        items = _redis_load()
        for item in items:
            if item.get("task_id") == task_id:
                item["progress"] = progress
                break
        _redis_save(items)


def update_completed(task_id: str, result_json: str) -> None:
    """任务完成。"""
    completed_at = datetime.now()
    if use_mysql():
        _mysql_update_result(task_id, result_json=result_json, completed_at=completed_at)
        _mysql_update_status(task_id, status="done", progress=100, completed_at=completed_at)
    else:
        items = _redis_load()
        for item in items:
            if item.get("task_id") == task_id:
                item["status"] = "done"
                item["progress"] = 100
                item["completed_at"] = completed_at.isoformat()
                item["result_json"] = result_json
                break
        _redis_save(items)


def update_failed(task_id: str, error_message: str) -> None:
    """任务失败。"""
    completed_at = datetime.now()
    if use_mysql():
        _mysql_update_error(task_id, error_message=error_message, completed_at=completed_at)
        _mysql_update_status(task_id, status="failed", completed_at=completed_at)
    else:
        items = _redis_load()
        for item in items:
            if item.get("task_id") == task_id:
                item["status"] = "failed"
                item["error_message"] = error_message
                item["completed_at"] = completed_at.isoformat()
                break
        _redis_save(items)


def get_by_prompt_id(prompt_id: str) -> Optional[dict]:
    """通过 prompt_id 查询任务（供 API 调用）。"""
    if use_mysql():
        return _mysql_get_by_prompt_id(prompt_id)
    else:
        items = _redis_load()
        for item in reversed(items):  # 最新的在前
            if item.get("prompt_id") == prompt_id:
                return item
        return None


def get_by_task_id(task_id: str) -> Optional[dict]:
    """通过 task_id（gateway_job_id）查询任务。"""
    if use_mysql():
        return _mysql_get_by_task_id(task_id)
    else:
        items = _redis_load()
        for item in items:
            if item.get("task_id") == task_id:
                return item
        return None


def list_tasks(limit: int = 100, offset: int = 0, worker_id: Optional[str] = None,
               status: Optional[str] = None) -> list:
    """查询任务列表（供 API 使用）。"""
    if use_mysql():
        return _mysql_list(limit=limit, offset=offset, worker_id=worker_id, status=status)
    else:
        items = _redis_load()
        # 按 status 过滤
        if status:
            items = [item for item in items if item.get("status") == status]

        # 按 submitted_at 倒序
        items.sort(key=lambda x: x.get("submitted_at", ""), reverse=True)

        # 分页
        return items[offset:offset + limit]


def ensure_table() -> None:
    """确保表存在（应用启动时调用）。"""
    if use_mysql():
        try:
            _mysql_create_table()
            print("[task_history] MySQL 表已就绪")
        except Exception as e:
            print(f"[task_history] MySQL 表创建失败: {e}")


def upsert_by_prompt_id(prompt_id: str, worker_id: str, priority: int = 0) -> str:
    """
    通过 prompt_id 创建或更新任务记录。
    如果 prompt_id 对应的任务已存在，更新 worker_id；
    如果不存在，创建新记录，task_id 使用 prompt_id。

    返回 task_id。
    """
    try:
        if use_mysql():
            from app.db import execute
            # 检查是否已存在
            existing = _mysql_get_by_prompt_id(prompt_id)
            if existing:
                # 更新 worker_id
                execute(
                    "UPDATE task_history SET worker_id = %s WHERE task_id = %s",
                    (worker_id, existing["task_id"])
                )
                return existing["task_id"]
            else:
                # 创建新记录，使用 prompt_id 作为 task_id
                _mysql_insert(
                    task_id=prompt_id,
                    prompt_id=prompt_id,
                    worker_id=worker_id,
                    priority=priority,
                    status="running",
                    progress=0,
                    started_at=datetime.now()
                )
                print(f"[task_history] 创建任务记录: {prompt_id}")
                return prompt_id
        else:
            items = _redis_load()
            # 查找是否已存在
            for item in items:
                if item.get("prompt_id") == prompt_id:
                    item["worker_id"] = worker_id
                    _redis_save(items)
                    return item["task_id"]
            # 创建新记录
            record = {
                "task_id": prompt_id,
                "prompt_id": prompt_id,
                "worker_id": worker_id,
                "priority": priority,
                "status": "running",
                "progress": 0,
                "error_message": None,
                "submitted_at": datetime.now().isoformat(),
                "started_at": datetime.now().isoformat(),
                "completed_at": None,
                "result_json": None
            }
            items.append(record)
            _redis_save(items)
            return prompt_id
    except Exception as e:
        print(f"[task_history] upsert_by_prompt_id 失败: {e}")
        raise


def sync_task_status(prompt_id: str, status: str, progress: int = None,
                     worker_id: str = None, error_message: str = None,
                     result_json: str = None) -> None:
    """
    同步任务状态（供列表查询时调用）。
    如果任务不存在，创建新记录。
    """
    completed_at = datetime.now() if status in ("done", "failed") else None

    if use_mysql():
        from app.db import execute, fetchone
        # 检查是否已存在
        row = fetchone("SELECT task_id FROM task_history WHERE prompt_id = %s", (prompt_id,))
        if row:
            # 更新现有记录
            sql = "UPDATE task_history SET status = %s"
            params = [status]
            if progress is not None:
                sql += ", progress = %s"
                params.append(progress)
            if worker_id is not None:
                sql += ", worker_id = %s"
                params.append(worker_id)
            if error_message is not None:
                sql += ", error_message = %s"
                params.append(error_message)
            if result_json is not None:
                sql += ", result_json = %s"
                params.append(result_json)
            if completed_at is not None:
                sql += ", completed_at = %s"
                params.append(completed_at)
            sql += " WHERE prompt_id = %s"
            params.append(prompt_id)
            execute(sql, params)
        else:
            # 创建新记录
            _mysql_insert(
                task_id=prompt_id,
                prompt_id=prompt_id,
                worker_id=worker_id,
                priority=0,
                status=status,
                progress=progress or 0,
                error_message=error_message,
                started_at=datetime.now() if status == "running" else None,
                completed_at=completed_at,
                result_json=result_json
            )
    else:
        items = _redis_load()
        found = False
        for item in items:
            if item.get("prompt_id") == prompt_id:
                item["status"] = status
                if progress is not None:
                    item["progress"] = progress
                if worker_id is not None:
                    item["worker_id"] = worker_id
                if error_message is not None:
                    item["error_message"] = error_message
                if result_json is not None:
                    item["result_json"] = result_json
                if completed_at is not None:
                    item["completed_at"] = completed_at.isoformat()
                found = True
                break
        if not found:
            # 创建新记录
            record = {
                "task_id": prompt_id,
                "prompt_id": prompt_id,
                "worker_id": worker_id,
                "priority": 0,
                "status": status,
                "progress": progress or 0,
                "error_message": error_message,
                "submitted_at": datetime.now().isoformat(),
                "started_at": datetime.now().isoformat() if status == "running" else None,
                "completed_at": completed_at.isoformat() if completed_at else None,
                "result_json": result_json
            }
            items.append(record)
        _redis_save(items)
