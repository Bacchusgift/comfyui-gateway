from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import workers as wm

router = APIRouter(prefix="/workers", tags=["workers"])

class CreateWorkerBody(BaseModel):
    url: str
    name: Optional[str] = None
    weight: int = 1
    auth_username: Optional[str] = None
    auth_password: Optional[str] = None

class UpdateWorkerBody(BaseModel):
    name: Optional[str] = None
    weight: Optional[int] = None
    enabled: Optional[bool] = None
    auth_username: Optional[str] = None
    auth_password: Optional[str] = None

@router.get("")
def list_workers():
    """GET /api/workers - 列表与状态（含队列、健康）"""
    arr = []
    for w in wm.list_workers():
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
def create_worker(body: CreateWorkerBody):
    """POST /api/workers - 注册 Worker（可选填 auth_username/auth_password 以通过 nginx 等反向代理认证）"""
    w = wm.add_worker(
        url=body.url,
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
        "auth_username": w.auth_username,
        "auth_has_password": bool(w.auth_password),
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
