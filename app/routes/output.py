"""
任务输出文件 API - 获取任务生成的图片、视频等文件。

GET /api/output/{prompt_id} - 获取任务输出文件列表
GET /api/view/{prompt_id} - 下载/预览具体文件
"""
from urllib.parse import urlencode
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response
from typing import Optional
import httpx

from app import store
from app import workers as wm
from app.client import get_history
from app.task_history import get_by_prompt_id
from app.config import WORKER_REQUEST_TIMEOUT

router = APIRouter(tags=["output"])


@router.get("/output/{prompt_id}")
async def get_output_files(prompt_id: str, request: Request):
    """
    GET /api/output/{prompt_id}

    获取任务的所有输出文件信息（从 history 中提取）。
    返回文件列表，包含可直接访问的 URL。
    """
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        task_record = get_by_prompt_id(prompt_id)
        if task_record:
            worker_id = task_record.get("worker_id")

    if not worker_id:
        raise HTTPException(status_code=404, detail="Task not found")

    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")

    # 获取 history
    hist, hist_status = await get_history(worker.url, prompt_id, auth=worker.auth())
    if hist_status != 200 or not hist or prompt_id not in hist:
        raise HTTPException(status_code=404, detail="Task history not found (task may still be running)")

    task_hist = hist[prompt_id]
    outputs = task_hist.get("outputs", {})

    # 构建返回的文件列表
    base_url = str(request.base_url).rstrip("/")
    output_list = []

    for node_id, node_output in outputs.items():
        files = []

        # 处理图片
        if "images" in node_output:
            for img in node_output["images"]:
                filename = img.get("filename", "")
                subfolder = img.get("subfolder", "")
                file_type = img.get("type", "output")
                view_url = f"{base_url}/api/view/{prompt_id}?filename={filename}&subfolder={subfolder}&type={file_type}"
                files.append({
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": file_type,
                    "url": view_url
                })

        # 处理视频
        if "videos" in node_output:
            for vid in node_output["videos"]:
                filename = vid.get("filename", "")
                subfolder = vid.get("subfolder", "")
                file_type = vid.get("type", "output")
                view_url = f"{base_url}/api/view/{prompt_id}?filename={filename}&subfolder={subfolder}&type={file_type}"
                files.append({
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": file_type,
                    "url": view_url
                })

        # 处理音频
        if "audio" in node_output:
            for aud in node_output["audio"]:
                filename = aud.get("filename", "")
                subfolder = aud.get("subfolder", "")
                file_type = aud.get("type", "output")
                view_url = f"{base_url}/api/view/{prompt_id}?filename={filename}&subfolder={subfolder}&type={file_type}"
                files.append({
                    "filename": filename,
                    "subfolder": subfolder,
                    "type": file_type,
                    "url": view_url
                })

        if files:
            output_list.append({
                "node_id": node_id,
                "files": files
            })

    return {
        "prompt_id": prompt_id,
        "status": task_hist.get("status", {}).get("status_str", "unknown"),
        "outputs": output_list
    }


@router.get("/view/{prompt_id}")
async def proxy_view(
    prompt_id: str,
    filename: str,
    subfolder: str = "",
    type: str = "output",
):
    """
    GET /api/view/{prompt_id}?filename=xxx&subfolder=xxx&type=output

    代理到对应 Worker 的 /view 接口获取文件。
    通过 prompt_id 自动定位 Worker。
    """
    worker_id = store.get_task_worker(prompt_id)
    if not worker_id:
        task_record = get_by_prompt_id(prompt_id)
        if task_record:
            worker_id = task_record.get("worker_id")

    if not worker_id:
        raise HTTPException(status_code=404, detail="Task not found")

    worker = wm.get_worker(worker_id)
    if not worker:
        raise HTTPException(status_code=503, detail="Worker no longer registered")

    # 构建 Worker 的 /view URL
    params = {"filename": filename, "type": type}
    if subfolder:
        params["subfolder"] = subfolder
    url = f"{worker.url.rstrip('/')}/view?{urlencode(params)}"

    try:
        kwargs: dict = {"timeout": WORKER_REQUEST_TIMEOUT}
        auth = worker.auth()
        if auth:
            kwargs["auth"] = httpx.BasicAuth(auth[0], auth[1])
        async with httpx.AsyncClient(**kwargs) as c:
            r = await c.get(url)
            return Response(
                content=r.content,
                status_code=r.status_code,
                media_type=r.headers.get("content-type"),
                headers={
                    "Content-Disposition": r.headers.get("Content-Disposition", f'attachment; filename="{filename}"')
                }
            )
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
