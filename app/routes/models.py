"""模型管理 API 路由。"""
from typing import Optional
from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel

from app import model_manager as mm
from app.db import execute

router = APIRouter(prefix="/models", tags=["models"])


# ==================== 请求模型 ====================

class UpdateModelSettingsBody(BaseModel):
    comfyui_models_root: Optional[str] = None
    civitai_api_token: Optional[str] = None


class ScanModelsBody(BaseModel):
    model_type_id: Optional[int] = None


class CreateDownloadBody(BaseModel):
    civitai_version_id: str
    model_type_id: int
    filename: Optional[str] = None


class DeleteModelBody(BaseModel):
    delete_file: bool = False


# ==================== 设置管理 ====================

@router.get("/settings")
def get_model_settings():
    """GET /api/models/settings - 获取模型管理设置。"""
    return mm.get_model_settings_for_api()


@router.patch("/settings")
def update_model_settings(body: UpdateModelSettingsBody):
    """PATCH /api/models/settings - 更新模型管理设置。"""
    return mm.update_model_settings(
        models_root=body.comfyui_models_root,
        civitai_token=body.civitai_api_token
    )


# ==================== 模型类型 ====================

@router.get("/types")
def get_model_types():
    """GET /api/models/types - 获取模型类型列表。"""
    return {"types": mm.get_model_types()}


# ==================== 模型列表与扫描 ====================

@router.get("")
def get_models(
    model_type_id: Optional[int] = None,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """GET /api/models - 获取模型列表。"""
    return mm.get_models(
        model_type_id=model_type_id,
        search=search,
        limit=min(limit, 500),
        offset=offset
    )


@router.post("/scan")
async def scan_models(body: ScanModelsBody, background_tasks: BackgroundTasks):
    """POST /api/models/scan - 触发模型扫描。"""
    # 如果没有指定类型，则扫描所有类型
    result = await mm.scan_models(body.model_type_id)
    return result


@router.get("/stats")
def get_model_stats():
    """GET /api/models/stats - 获取模型统计信息。"""
    return mm.get_model_stats()


@router.delete("/{model_id}")
def delete_model(model_id: int, delete_file: bool = False):
    """DELETE /api/models/{model_id} - 删除模型记录。"""
    result = mm.delete_model(model_id, delete_file=delete_file)
    if "error" in result:
        raise HTTPException(status_code=404, detail=result["error"])
    return result


# ==================== Civitai API ====================

@router.get("/civitai/versions/{version_id}")
async def get_civitai_version(version_id: str):
    """GET /api/models/civitai/versions/{version_id} - 获取 Civitai 版本信息。"""
    result = await mm.fetch_civitai_version(version_id)
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result


# ==================== 下载管理 ====================

@router.get("/downloads")
def get_downloads():
    """GET /api/models/downloads - 获取下载任务列表。"""
    return {"downloads": mm.get_download_tasks()}


@router.post("/downloads")
async def create_download(body: CreateDownloadBody, background_tasks: BackgroundTasks):
    """POST /api/models/downloads - 创建下载任务。"""
    # 获取版本信息
    version_info = await mm.fetch_civitai_version(body.civitai_version_id)
    if "error" in version_info:
        raise HTTPException(status_code=400, detail=version_info["error"])

    # 确定文件名和下载 URL
    download_url = version_info.get("download_url")
    files = version_info.get("files", [])

    # 优先选择 Model 类型的文件
    model_file = None
    for f in files:
        if f.get("type") == "Model":
            model_file = f
            break

    if model_file:
        filename = body.filename or model_file.get("name")
        download_url = model_file.get("download_url") or download_url
    else:
        filename = body.filename or f"{version_info.get('model_name', 'model')}_{version_info.get('version_name', 'v1')}.safetensors"

    if not download_url:
        raise HTTPException(status_code=400, detail="无法获取下载链接")

    # 获取文件大小
    total_bytes = 0
    if model_file and model_file.get("size_kb"):
        total_bytes = int(model_file["size_kb"] * 1024)

    # 创建下载任务
    task = mm.create_download_task(
        model_type_id=body.model_type_id,
        civitai_version_id=body.civitai_version_id,
        filename=filename,
        download_url=download_url,
        total_bytes=total_bytes
    )

    # 在后台启动下载
    background_tasks.add_task(mm.start_download, task["download_id"])

    return task


@router.get("/downloads/{download_id}")
def get_download(download_id: str):
    """GET /api/models/downloads/{download_id} - 获取单个下载任务状态。"""
    task = mm.get_download_task(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="下载任务不存在")
    return task


@router.delete("/downloads/{download_id}")
def cancel_download(download_id: str):
    """DELETE /api/models/downloads/{download_id} - 取消下载任务。"""
    task = mm.get_download_task(download_id)
    if not task:
        raise HTTPException(status_code=404, detail="下载任务不存在")

    if task["status"] not in ("pending", "downloading"):
        raise HTTPException(status_code=400, detail="任务已完成或已取消")

    mm.cancel_download(download_id)
    return {"message": "已取消下载"}
