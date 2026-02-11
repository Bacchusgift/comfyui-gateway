from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import workers as wm
from app.client import health_check

router = APIRouter(prefix="/workers", tags=["workers"])

class CreateWorkerBody(BaseModel):
    url: str
    name: Optional[str] = None
    weight: int = 1
    auth_username: Optional[str] = None
    auth_password: Optional[str] = None
    skip_health_check: bool = False  # 跳过注册时的联通检测（调试用）

class UpdateWorkerBody(BaseModel):
    name: Optional[str] = None
    weight: Optional[int] = None
    enabled: Optional[bool] = None
    auth_username: Optional[str] = None
    auth_password: Optional[str] = None


@router.get("")
async def list_workers():
    """GET /api/workers - 列表与状态（含队列、健康）"""
    workers = wm.list_workers()
    # 对每个 Worker 做一次快速健康探测，确保状态实时
    for w in workers:
        if w.enabled:
            healthy, detail = await health_check(w.url, auth=w.auth())
            wm.update_worker_load(w.worker_id, w.queue_running, w.queue_pending, healthy=healthy)
            w.healthy = healthy
    arr = []
    for w in workers:
        arr.append({
            "worker_id": w.worker_id,
            "url": w.url,
            "name": w.name,
            "weight": w.weight,
            "enabled": w.enabled,
            "healthy": w.healthy,
            "queue_running": w.queue_running,
            "queue_pending": w.queue_pending,
            "auth_username": w.auth_username,
            "auth_has_password": bool(w.auth_password),
        })
    return {"workers": arr}


@router.post("")
async def create_worker(body: CreateWorkerBody):
    """POST /api/workers - 注册 Worker，会先探测连通性，不通则拒绝注册"""
    url = body.url.rstrip("/")
    auth = None
    if body.auth_username and body.auth_password:
        auth = (body.auth_username, body.auth_password)

    if not body.skip_health_check:
        healthy, detail = await health_check(url, auth=auth)
        if not healthy:
            raise HTTPException(
                status_code=422,
                detail=f"无法连接到 ComfyUI Worker ({url})：{detail}。请检查地址与网络后重试，或传 skip_health_check=true 跳过检测。",
            )

    w = wm.add_worker(
        url=url,
        name=body.name,
        weight=body.weight,
        auth_username=body.auth_username,
        auth_password=body.auth_password,
    )
    return {
        "worker_id": w.worker_id,
        "url": w.url,
        "name": w.name,
        "weight": w.weight,
        "enabled": w.enabled,
        "healthy": True,
        "auth_username": w.auth_username,
        "auth_has_password": bool(w.auth_password),
    }


@router.post("/{worker_id}/health")
async def check_worker_health(worker_id: str):
    """POST /api/workers/{id}/health - 手动触发单个 Worker 健康探测"""
    w = wm.get_worker(worker_id)
    if not w:
        raise HTTPException(status_code=404, detail="Worker not found")
    healthy, detail = await health_check(w.url, auth=w.auth())
    wm.update_worker_load(w.worker_id, w.queue_running, w.queue_pending, healthy=healthy)
    return {
        "worker_id": w.worker_id,
        "healthy": healthy,
        "detail": detail,
    }


@router.patch("/{worker_id}")
def update_worker(worker_id: str, body: UpdateWorkerBody):
    """PATCH /api/workers/{id} - 更新 name / weight / enabled / auth"""
    w = wm.update_worker(
        worker_id,
        name=body.name,
        weight=body.weight,
        enabled=body.enabled,
        auth_username=body.auth_username,
        auth_password=body.auth_password,
    )
    if not w:
        raise HTTPException(status_code=404, detail="Worker not found")
    return {
        "worker_id": w.worker_id,
        "url": w.url,
        "name": w.name,
        "weight": w.weight,
        "enabled": w.enabled,
        "auth_username": w.auth_username,
        "auth_has_password": bool(w.auth_password),
    }


@router.delete("/{worker_id}")
def delete_worker(worker_id: str):
    """DELETE /api/workers/{id}"""
    if not wm.remove_worker(worker_id):
        raise HTTPException(status_code=404, detail="Worker not found")
    return {"ok": True}
