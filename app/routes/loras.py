"""
LoRA 管理 API 路由
提供 LoRA 的 CRUD 操作，以及关键词、基模关联、触发词的管理
"""

from typing import Optional, List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import lora_manager as lm

router = APIRouter(prefix="/loras", tags=["loras"])


# ==================== Pydantic 模型 ====================

class CreateLoraBody(BaseModel):
    lora_name: str
    display_name: Optional[str] = None
    description: Optional[str] = None
    priority: int = 0
    enabled: bool = True
    file_size: int = 0
    civitai_model_id: Optional[str] = None
    civitai_version_id: Optional[str] = None
    civitai_preview_url: Optional[str] = None


class UpdateLoraBody(BaseModel):
    lora_name: Optional[str] = None
    display_name: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[int] = None
    enabled: Optional[bool] = None
    file_size: Optional[int] = None
    civitai_model_id: Optional[str] = None
    civitai_version_id: Optional[str] = None
    civitai_preview_url: Optional[str] = None


class CreateKeywordBody(BaseModel):
    keyword: str
    weight: float = 1.0


class CreateBaseModelBody(BaseModel):
    base_model_name: Optional[str] = None
    base_model_filename: Optional[str] = None
    compatible: bool = True
    notes: Optional[str] = None


class CreateTriggerWordBody(BaseModel):
    trigger_word: str
    weight: float = 1.0
    is_negative: bool = False


# ==================== LoRA CRUD ====================

@router.get("")
async def list_loras(
    enabled_only: bool = False,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """
    GET /api/loras - 获取 LoRA 列表

    查询参数：
    - enabled_only: 只返回启用的 LoRA
    - search: 搜索关键词（匹配 lora_name 或 display_name）
    - limit: 返回数量限制（默认 100）
    - offset: 偏移量
    """
    loras = lm.list_loras(
        enabled_only=enabled_only,
        search=search,
        limit=limit,
        offset=offset
    )
    total = lm.count_loras(
        enabled_only=enabled_only,
        search=search
    )

    return {
        "loras": loras,
        "total": total
    }


@router.post("")
async def create_lora(body: CreateLoraBody):
    """
    POST /api/loras - 创建 LoRA

    请求体：
    - lora_name: LoRA 文件名或唯一标识（必填）
    - display_name: 显示名称
    - description: 功能描述
    - priority: 优先级（用于排序）
    - enabled: 是否启用
    - file_size: 文件大小（字节）
    - civitai_model_id: Civitai 模型 ID
    - civitai_version_id: Civitai 版本 ID
    - civitai_preview_url: Civitai 预览图 URL
    """
    try:
        lora_id = lm.create_lora(
            lora_name=body.lora_name,
            display_name=body.display_name,
            description=body.description,
            priority=body.priority,
            enabled=body.enabled,
            file_size=body.file_size,
            civitai_model_id=body.civitai_model_id,
            civitai_version_id=body.civitai_version_id,
            civitai_preview_url=body.civitai_preview_url
        )
        lora = lm.get_lora(lora_id)
        return lora
    except Exception as e:
        if "Duplicate entry" in str(e):
            raise HTTPException(status_code=409, detail=f"LoRA 名称 '{body.lora_name}' 已存在")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/{lora_id}")
async def get_lora(lora_id: int):
    """
    GET /api/loras/{id} - 获取 LoRA 详情
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")
    return lora


@router.put("/{lora_id}")
async def update_lora(lora_id: int, body: UpdateLoraBody):
    """
    PUT /api/loras/{id} - 更新 LoRA

    请求体（所有字段可选）：
    - lora_name, display_name, description, priority, enabled,
      file_size, civitai_model_id, civitai_version_id, civitai_preview_url
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    try:
        lm.update_lora(
            lora_id=lora_id,
            lora_name=body.lora_name,
            display_name=body.display_name,
            description=body.description,
            priority=body.priority,
            enabled=body.enabled,
            file_size=body.file_size,
            civitai_model_id=body.civitai_model_id,
            civitai_version_id=body.civitai_version_id,
            civitai_preview_url=body.civitai_preview_url
        )
        updated_lora = lm.get_lora(lora_id)
        return updated_lora
    except Exception as e:
        if "Duplicate entry" in str(e):
            raise HTTPException(status_code=409, detail=f"LoRA 名称 '{body.lora_name}' 已存在")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/{lora_id}")
async def delete_lora(lora_id: int):
    """
    DELETE /api/loras/{id} - 删除 LoRA

    级联删除关联的关键词、基模关联、触发词
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    lm.delete_lora(lora_id)
    return {"message": f"LoRA {lora_id} 已删除"}


# ==================== 关键词管理 ====================

@router.get("/{lora_id}/keywords")
async def get_lora_keywords(lora_id: int):
    """
    GET /api/loras/{id}/keywords - 获取 LoRA 的关键词列表
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    keywords = lm.get_lora_keywords(lora_id)
    return {"keywords": keywords}


@router.post("/{lora_id}/keywords")
async def add_lora_keyword(lora_id: int, body: CreateKeywordBody):
    """
    POST /api/loras/{id}/keywords - 添加关键词

    请求体：
    - keyword: 关键词
    - weight: 权重（默认 1.0）
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    keyword_id = lm.add_keyword(
        lora_id=lora_id,
        keyword=body.keyword,
        weight=body.weight
    )
    keywords = lm.get_lora_keywords(lora_id)
    return {"keywords": keywords}


@router.delete("/{lora_id}/keywords/{keyword_id}")
async def delete_lora_keyword(lora_id: int, keyword_id: int):
    """
    DELETE /api/loras/{id}/keywords/{kw_id} - 删除关键词
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    lm.delete_keyword(lora_id, keyword_id)
    return {"message": "关键词已删除"}


# ==================== 基模关联管理 ====================

@router.get("/{lora_id}/base-models")
async def get_lora_base_models(lora_id: int):
    """
    GET /api/loras/{id}/base-models - 获取 LoRA 的基模关联列表
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    base_models = lm.get_lora_base_models(lora_id)
    return {"base_models": base_models}


@router.post("/{lora_id}/base-models")
async def add_lora_base_model(lora_id: int, body: CreateBaseModelBody):
    """
    POST /api/loras/{id}/base-models - 添加基模关联

    请求体：
    - base_model_name: 基模名称（如 "SD 1.5", "SDXL"）
    - base_model_filename: 基模文件名（如 "v1-5-pruned.safetensors"）
    - compatible: 是否兼容（默认 True）
    - notes: 备注
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    assoc_id = lm.add_base_model(
        lora_id=lora_id,
        base_model_name=body.base_model_name,
        base_model_filename=body.base_model_filename,
        compatible=body.compatible,
        notes=body.notes
    )
    base_models = lm.get_lora_base_models(lora_id)
    return {"base_models": base_models}


@router.delete("/{lora_id}/base-models/{assoc_id}")
async def delete_lora_base_model(lora_id: int, assoc_id: int):
    """
    DELETE /api/loras/{id}/base-models/{assoc_id} - 删除基模关联
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    lm.delete_base_model(lora_id, assoc_id)
    return {"message": "基模关联已删除"}


# ==================== 触发词管理 ====================

@router.get("/{lora_id}/trigger-words")
async def get_lora_trigger_words(lora_id: int):
    """
    GET /api/loras/{id}/trigger-words - 获取 LoRA 的触发词列表
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    trigger_words = lm.get_lora_trigger_words(lora_id)
    return {"trigger_words": trigger_words}


@router.post("/{lora_id}/trigger-words")
async def add_lora_trigger_word(lora_id: int, body: CreateTriggerWordBody):
    """
    POST /api/loras/{id}/trigger-words - 添加触发词

    请求体：
    - trigger_word: 触发词
    - weight: 权重（默认 1.0）
    - is_negative: 是否为负向触发词（默认 False）
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    tw_id = lm.add_trigger_word(
        lora_id=lora_id,
        trigger_word=body.trigger_word,
        weight=body.weight,
        is_negative=body.is_negative
    )
    trigger_words = lm.get_lora_trigger_words(lora_id)
    return {"trigger_words": trigger_words}


@router.delete("/{lora_id}/trigger-words/{tw_id}")
async def delete_lora_trigger_word(lora_id: int, tw_id: int):
    """
    DELETE /api/loras/{id}/trigger-words/{tw_id} - 删除触发词
    """
    lora = lm.get_lora(lora_id)
    if not lora:
        raise HTTPException(status_code=404, detail=f"LoRA {lora_id} 不存在")

    lm.delete_trigger_word(lora_id, tw_id)
    return {"message": "触发词已删除"}


# ==================== 扫描功能 ====================

@router.post("/scan")
async def scan_loras():
    """
    POST /api/loras/scan - 扫描 loras 文件夹

    扫描 ComfyUI 模型目录下的 loras 文件夹，自动添加新的 LoRA 到数据库。

    支持的文件格式：.safetensors, .ckpt, .pt, .bin, .pth

    返回：
    - scanned: 扫描的文件总数
    - added: 新增的 LoRA 数量
    - updated: 更新的 LoRA 数量
    - errors: 错误列表
    """
    result = await lm.scan_loras_folder()

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


@router.get("/file-info/{lora_name}")
async def get_lora_file_info(lora_name: str):
    """
    GET /api/loras/file-info/{lora_name} - 获取 LoRA 文件信息

    获取指定 LoRA 的文件信息（路径、大小等）。

    参数：
    - lora_name: LoRA 相对路径（URL 编码）

    返回：
    - full_path: 完整文件路径
    - filename: 文件名
    - file_size: 文件大小
    - exists: 文件是否存在
    """
    from urllib.parse import unquote

    # URL 解码
    decoded_name = unquote(lora_name)

    result = lm.get_lora_file_info(decoded_name)

    if not result:
        raise HTTPException(status_code=404, detail=f"LoRA 文件不存在: {decoded_name}")

    return result


@router.get("/base-models/available")
async def get_available_base_models():
    """
    GET /api/loras/base-models/available - 获取可用的基模列表

    扫描 checkpoints 和 diffusion_models 文件夹，返回可用的基模文件。

    返回：
    - checkpoints: checkpoints 文件夹中的模型列表
      - filename: 文件名
      - relative_path: 相对路径
      - file_size: 文件大小
    - diffusion_models: diffusion_models 文件夹中的模型列表
      - filename: 文件名
      - relative_path: 相对路径
      - file_size: 文件大小
    """
    from app.model_manager import scan_base_model_folders

    result = scan_base_model_folders()

    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])

    return result


