"""
ComfyUI 模型管理器核心模块。
支持：模型扫描、Civitai API 集成、模型下载管理。
"""
import asyncio
import hashlib
import json
import os
import uuid
from datetime import datetime
from pathlib import Path
from typing import Optional

import httpx

from app.config import use_mysql, COMFYUI_MODELS_ROOT, CIVITAI_API_TOKEN
from app.db import execute, fetchone, fetchall
from app import settings as st

# 默认模型类型配置
DEFAULT_MODEL_TYPES = [
    {"type_name": "checkpoints", "display_name": "主模型", "directory": "checkpoints", "file_extensions": [".safetensors", ".ckpt", ".pt", ".bin", ".pth"], "icon": "model", "sort_order": 1},
    {"type_name": "loras", "display_name": "LoRA", "directory": "loras", "file_extensions": [".safetensors", ".ckpt"], "icon": "lora", "sort_order": 2},
    {"type_name": "embeddings", "display_name": "Embedding", "directory": "embeddings", "file_extensions": [".safetensors", ".pt", ".bin"], "icon": "embedding", "sort_order": 3},
    {"type_name": "vae", "display_name": "VAE", "directory": "vae", "file_extensions": [".safetensors", ".pt", ".bin"], "icon": "vae", "sort_order": 4},
    {"type_name": "controlnet", "display_name": "ControlNet", "directory": "controlnet", "file_extensions": [".safetensors", ".pth"], "icon": "controlnet", "sort_order": 5},
    {"type_name": "upscale_models", "display_name": "放大模型", "directory": "upscale_models", "file_extensions": [".safetensors", ".pt", ".pth", ".bin"], "icon": "upscale", "sort_order": 6},
    {"type_name": "ipadapter", "display_name": "IPAdapter", "directory": "ipadapter", "file_extensions": [".safetensors", ".pth"], "icon": "ipadapter", "sort_order": 7},
    {"type_name": "clip", "display_name": "CLIP", "directory": "clip", "file_extensions": [".safetensors", ".pt", ".bin"], "icon": "clip", "sort_order": 8},
    {"type_name": "unet", "display_name": "UNet", "directory": "unet", "file_extensions": [".safetensors", ".pt", ".bin"], "icon": "unet", "sort_order": 9},
]


def ensure_tables():
    """确保模型管理相关表存在。"""
    if not use_mysql():
        print("[model_manager] 未配置 MySQL，跳过表创建")
        return

    try:
        # 模型类型表
        execute("""
            CREATE TABLE IF NOT EXISTS model_types (
                id INT AUTO_INCREMENT PRIMARY KEY,
                type_name VARCHAR(64) NOT NULL UNIQUE,
                display_name VARCHAR(128) NOT NULL,
                directory VARCHAR(255) NOT NULL,
                file_extensions JSON,
                icon VARCHAR(64),
                sort_order INT DEFAULT 0,
                enabled BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        # 模型表
        execute("""
            CREATE TABLE IF NOT EXISTS models (
                id INT AUTO_INCREMENT PRIMARY KEY,
                model_type_id INT NOT NULL,
                filename VARCHAR(255) NOT NULL,
                file_path VARCHAR(512) NOT NULL,
                file_size BIGINT DEFAULT 0,
                civitai_model_id VARCHAR(64),
                civitai_version_id VARCHAR(64),
                civitai_model_name VARCHAR(255),
                civitai_preview_url VARCHAR(512),
                civitai_base_model VARCHAR(64),
                is_scanned BOOLEAN DEFAULT TRUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                UNIQUE KEY uk_model_path (model_type_id, file_path(255)),
                INDEX idx_civitai_version (civitai_version_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        # 模型预览图表
        execute("""
            CREATE TABLE IF NOT EXISTS model_previews (
                id INT AUTO_INCREMENT PRIMARY KEY,
                model_id INT NOT NULL,
                preview_url VARCHAR(512),
                local_path VARCHAR(512),
                nsfw BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (model_id) REFERENCES models(id) ON DELETE CASCADE
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        # 下载任务表
        execute("""
            CREATE TABLE IF NOT EXISTS model_downloads (
                id INT AUTO_INCREMENT PRIMARY KEY,
                download_id VARCHAR(64) NOT NULL UNIQUE,
                model_type_id INT NOT NULL,
                civitai_version_id VARCHAR(64) NOT NULL,
                download_url VARCHAR(1024),
                filename VARCHAR(255) NOT NULL,
                status VARCHAR(32) DEFAULT 'pending',
                progress INT DEFAULT 0,
                bytes_downloaded BIGINT DEFAULT 0,
                total_bytes BIGINT DEFAULT 0,
                error_message TEXT,
                result_model_id INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP NULL,
                INDEX idx_status (status)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        """)

        print("[model_manager] MySQL 表已就绪")

        # 初始化默认模型类型
        _init_model_types()

    except Exception as e:
        print(f"[model_manager] MySQL 表创建失败: {e}")


def _init_model_types():
    """初始化默认模型类型配置。"""
    existing = fetchall("SELECT type_name FROM model_types")
    existing_names = {row["type_name"] for row in existing} if existing else set()

    for mt in DEFAULT_MODEL_TYPES:
        if mt["type_name"] not in existing_names:
            execute("""
                INSERT INTO model_types (type_name, display_name, directory, file_extensions, icon, sort_order)
                VALUES (%s, %s, %s, %s, %s, %s)
            """, (mt["type_name"], mt["display_name"], mt["directory"],
                  json.dumps(mt["file_extensions"]), mt["icon"], mt["sort_order"]))
            print(f"[model_manager] 添加模型类型: {mt['type_name']}")


# ==================== 设置管理 ====================

def get_models_root() -> Optional[str]:
    """获取模型根目录，优先使用页面配置，其次使用环境变量。"""
    if use_mysql():
        val = st._mysql_get("comfyui_models_root")
        if val:
            return val
    return COMFYUI_MODELS_ROOT


def set_models_root(path: Optional[str]) -> None:
    """设置模型根目录。"""
    if use_mysql():
        st._mysql_set("comfyui_models_root", path)


def get_civitai_token() -> Optional[str]:
    """获取 Civitai API Token。"""
    if use_mysql():
        val = st._mysql_get("civitai_api_token")
        if val:
            return val
    return CIVITAI_API_TOKEN


def set_civitai_token(token: Optional[str]) -> None:
    """设置 Civitai API Token。"""
    if use_mysql():
        st._mysql_set("civitai_api_token", token)


def get_model_settings_for_api() -> dict:
    """获取模型管理设置。"""
    models_root = get_models_root()
    civitai_token = get_civitai_token()
    return {
        "comfyui_models_root": models_root,
        "civitai_api_token": civitai_token[:8] + "****" if civitai_token and len(civitai_token) > 8 else None,
        "civitai_has_token": bool(civitai_token),
    }


def update_model_settings(models_root: Optional[str] = None, civitai_token: Optional[str] = None) -> dict:
    """更新模型管理设置。"""
    if models_root is not None:
        set_models_root(models_root)
    if civitai_token is not None and civitai_token != "****":
        set_civitai_token(civitai_token)
    return get_model_settings_for_api()


# ==================== 模型类型管理 ====================

def get_model_types() -> list:
    """获取所有模型类型。"""
    if not use_mysql():
        return []
    rows = fetchall("SELECT * FROM model_types WHERE enabled = TRUE ORDER BY sort_order")
    result = []
    for row in rows:
        row["file_extensions"] = json.loads(row["file_extensions"]) if row["file_extensions"] else []
        result.append(row)
    return result


def get_model_type_by_name(type_name: str) -> Optional[dict]:
    """根据类型名获取模型类型。"""
    if not use_mysql():
        return None
    row = fetchone("SELECT * FROM model_types WHERE type_name = %s", (type_name,))
    if row:
        row["file_extensions"] = json.loads(row["file_extensions"]) if row["file_extensions"] else []
    return row


# ==================== 模型扫描 ====================

async def scan_models(model_type_id: Optional[int] = None) -> dict:
    """扫描模型目录并更新数据库。"""
    models_root = get_models_root()
    if not models_root:
        return {"error": "未配置模型根目录", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    root_path = Path(models_root)
    if not root_path.exists():
        return {"error": f"模型根目录不存在: {models_root}", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    if not use_mysql():
        return {"error": "需要 MySQL 支持", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    # 获取要扫描的模型类型
    if model_type_id:
        model_types = fetchall("SELECT * FROM model_types WHERE id = %s AND enabled = TRUE", (model_type_id,))
    else:
        model_types = fetchall("SELECT * FROM model_types WHERE enabled = TRUE ORDER BY sort_order")

    if not model_types:
        return {"error": "未找到启用的模型类型", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    stats = {"scanned": 0, "added": 0, "updated": 0, "errors": []}

    for mt in model_types:
        mt_dir = root_path / mt["directory"]
        if not mt_dir.exists():
            stats["errors"].append(f"模型类型目录不存在: {mt['directory']}")
            continue

        extensions = json.loads(mt["file_extensions"]) if mt["file_extensions"] else []

        for ext in extensions:
            for file_path in mt_dir.glob(f"*{ext}"):
                stats["scanned"] += 1
                try:
                    file_size = file_path.stat().st_size
                    rel_path = str(file_path.relative_to(root_path))

                    # 检查是否已存在
                    existing = fetchone(
                        "SELECT id FROM models WHERE model_type_id = %s AND file_path = %s",
                        (mt["id"], rel_path)
                    )

                    if existing:
                        # 更新文件大小
                        execute(
                            "UPDATE models SET file_size = %s, updated_at = NOW() WHERE id = %s",
                            (file_size, existing["id"])
                        )
                        stats["updated"] += 1
                    else:
                        # 添加新记录
                        execute("""
                            INSERT INTO models (model_type_id, filename, file_path, file_size, is_scanned)
                            VALUES (%s, %s, %s, %s, TRUE)
                        """, (mt["id"], file_path.name, rel_path, file_size))
                        stats["added"] += 1

                except Exception as e:
                    stats["errors"].append(f"{file_path}: {str(e)}")

    return stats


# ==================== Civitai API ====================

async def fetch_civitai_version(version_id: str) -> dict:
    """从 Civitai 获取版本信息。"""
    token = get_civitai_token()
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            resp = await client.get(
                f"https://civitai.com/api/v1/model-versions/{version_id}",
                headers=headers
            )
            if resp.status_code == 404:
                return {"error": "版本不存在"}
            if resp.status_code != 200:
                return {"error": f"Civitai API 错误: {resp.status_code}"}

            data = resp.json()
            return {
                "version_id": str(data.get("id")),
                "version_name": data.get("name"),
                "model_id": str(data.get("modelId")),
                "model_name": data.get("model", {}).get("name"),
                "model_type": data.get("model", {}).get("type"),
                "base_model": data.get("baseModel"),
                "download_url": data.get("downloadUrl"),
                "files": [
                    {
                        "name": f.get("name"),
                        "size_kb": f.get("sizeKB"),
                        "type": f.get("type"),
                        "download_url": f.get("downloadUrl"),
                    }
                    for f in data.get("files", [])
                ],
                "images": [
                    {"url": img.get("url"), "nsfw": img.get("nsfw", "None") != "None"}
                    for img in data.get("images", [])[:5]
                ],
            }
        except httpx.TimeoutException:
            return {"error": "Civitai API 超时"}
        except Exception as e:
            return {"error": f"请求失败: {str(e)}"}


# ==================== 下载管理 ====================

# 下载任务存储（内存）
_download_tasks: dict = {}
_download_cancel_flags: dict = {}


def create_download_task(model_type_id: int, civitai_version_id: str, filename: str,
                         download_url: str, total_bytes: int = 0) -> dict:
    """创建下载任务。"""
    download_id = str(uuid.uuid4())[:8]

    task = {
        "download_id": download_id,
        "model_type_id": model_type_id,
        "civitai_version_id": civitai_version_id,
        "filename": filename,
        "download_url": download_url,
        "status": "pending",
        "progress": 0,
        "bytes_downloaded": 0,
        "total_bytes": total_bytes,
        "error_message": None,
        "created_at": datetime.now().isoformat(),
    }

    # 存入数据库
    if use_mysql():
        execute("""
            INSERT INTO model_downloads (download_id, model_type_id, civitai_version_id, download_url, filename, status, total_bytes)
            VALUES (%s, %s, %s, %s, %s, 'pending', %s)
        """, (download_id, model_type_id, civitai_version_id, download_url, filename, total_bytes))

    _download_tasks[download_id] = task
    _download_cancel_flags[download_id] = False

    return task


def get_download_tasks() -> list:
    """获取所有下载任务。"""
    if use_mysql():
        rows = fetchall("""
            SELECT d.*, mt.display_name as model_type_name
            FROM model_downloads d
            LEFT JOIN model_types mt ON d.model_type_id = mt.id
            ORDER BY d.created_at DESC
            LIMIT 100
        """)
        return rows or []
    return list(_download_tasks.values())


def get_download_task(download_id: str) -> Optional[dict]:
    """获取单个下载任务。"""
    if use_mysql():
        row = fetchone("""
            SELECT d.*, mt.display_name as model_type_name
            FROM model_downloads d
            LEFT JOIN model_types mt ON d.model_type_id = mt.id
            WHERE d.download_id = %s
        """, (download_id,))
        return row
    return _download_tasks.get(download_id)


def cancel_download(download_id: str) -> bool:
    """取消下载任务。"""
    _download_cancel_flags[download_id] = True

    if use_mysql():
        execute(
            "UPDATE model_downloads SET status = 'cancelled', completed_at = NOW() WHERE download_id = %s AND status IN ('pending', 'downloading')",
            (download_id,)
        )

    return True


async def start_download(download_id: str):
    """启动下载任务。"""
    task = get_download_task(download_id)
    if not task:
        return

    models_root = get_models_root()
    if not models_root:
        _update_task_error(download_id, "未配置模型根目录")
        return

    # 获取模型类型目录
    mt = fetchone("SELECT directory FROM model_types WHERE id = %s", (task["model_type_id"],))
    if not mt:
        _update_task_error(download_id, "模型类型不存在")
        return

    target_dir = Path(models_root) / mt["directory"]
    target_dir.mkdir(parents=True, exist_ok=True)
    target_path = target_dir / task["filename"]

    token = get_civitai_token()
    headers = {}
    if token:
        headers["Authorization"] = f"Bearer {token}"

    _update_task_status(download_id, "downloading")

    try:
        async with httpx.AsyncClient(timeout=300.0, follow_redirects=True) as client:
            async with client.stream("GET", task["download_url"], headers=headers) as response:
                if response.status_code != 200:
                    _update_task_error(download_id, f"下载失败: HTTP {response.status_code}")
                    return

                total = int(response.headers.get("content-length", 0))
                if total:
                    execute("UPDATE model_downloads SET total_bytes = %s WHERE download_id = %s", (total, download_id))

                downloaded = 0
                with open(target_path, "wb") as f:
                    async for chunk in response.aiter_bytes(chunk_size=8192):
                        if _download_cancel_flags.get(download_id):
                            target_path.unlink(missing_ok=True)
                            _update_task_status(download_id, "cancelled")
                            return

                        f.write(chunk)
                        downloaded += len(chunk)

                        # 更新进度
                        progress = int(downloaded * 100 / total) if total else 0
                        if downloaded % (1024 * 1024) < 8192:  # 每 ~1MB 更新一次
                            _update_task_progress(download_id, progress, downloaded)

                # 下载完成
                _complete_download(download_id, str(target_path), downloaded)

    except asyncio.CancelledError:
        target_path.unlink(missing_ok=True)
        _update_task_status(download_id, "cancelled")
    except Exception as e:
        target_path.unlink(missing_ok=True)
        _update_task_error(download_id, str(e))


def _update_task_status(download_id: str, status: str):
    """更新任务状态。"""
    if use_mysql():
        execute("UPDATE model_downloads SET status = %s WHERE download_id = %s", (status, download_id))
    if download_id in _download_tasks:
        _download_tasks[download_id]["status"] = status


def _update_task_progress(download_id: str, progress: int, bytes_downloaded: int):
    """更新下载进度。"""
    if use_mysql():
        execute(
            "UPDATE model_downloads SET progress = %s, bytes_downloaded = %s WHERE download_id = %s",
            (progress, bytes_downloaded, download_id)
        )
    if download_id in _download_tasks:
        _download_tasks[download_id]["progress"] = progress
        _download_tasks[download_id]["bytes_downloaded"] = bytes_downloaded


def _update_task_error(download_id: str, error: str):
    """更新任务错误。"""
    if use_mysql():
        execute(
            "UPDATE model_downloads SET status = 'failed', error_message = %s, completed_at = NOW() WHERE download_id = %s",
            (error, download_id)
        )
    if download_id in _download_tasks:
        _download_tasks[download_id]["status"] = "failed"
        _download_tasks[download_id]["error_message"] = error


def _complete_download(download_id: str, file_path: str, file_size: int):
    """完成下载并添加模型记录。"""
    task = get_download_task(download_id)
    if not task:
        return

    if use_mysql():
        # 添加模型记录
        models_root = get_models_root()
        rel_path = str(Path(file_path).relative_to(models_root)) if models_root else file_path

        result = fetchone(
            "SELECT id FROM models WHERE model_type_id = %s AND file_path = %s",
            (task["model_type_id"], rel_path)
        )

        if result:
            model_id = result["id"]
            execute("""
                UPDATE models SET file_size = %s, civitai_version_id = %s, updated_at = NOW()
                WHERE id = %s
            """, (file_size, task["civitai_version_id"], model_id))
        else:
            cursor_id = execute("""
                INSERT INTO models (model_type_id, filename, file_path, file_size, civitai_version_id, is_scanned)
                VALUES (%s, %s, %s, %s, %s, FALSE)
            """, (task["model_type_id"], task["filename"], rel_path, file_size, task["civitai_version_id"]))

            # 获取插入的 ID
            result = fetchone(
                "SELECT id FROM models WHERE model_type_id = %s AND file_path = %s",
                (task["model_type_id"], rel_path)
            )
            model_id = result["id"] if result else None

        # 更新下载任务状态
        execute("""
            UPDATE model_downloads SET status = 'completed', progress = 100, bytes_downloaded = %s,
            result_model_id = %s, completed_at = NOW()
            WHERE download_id = %s
        """, (file_size, model_id, download_id))

    if download_id in _download_tasks:
        _download_tasks[download_id]["status"] = "completed"
        _download_tasks[download_id]["progress"] = 100
        _download_tasks[download_id]["bytes_downloaded"] = file_size


# ==================== 模型管理 ====================

def get_models(model_type_id: Optional[int] = None, search: Optional[str] = None,
               limit: int = 100, offset: int = 0) -> dict:
    """获取模型列表。"""
    if not use_mysql():
        return {"models": [], "total": 0}

    where_clauses = []
    params = []

    if model_type_id:
        where_clauses.append("m.model_type_id = %s")
        params.append(model_type_id)

    if search:
        where_clauses.append("(m.filename LIKE %s OR m.civitai_model_name LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    where_sql = " AND ".join(where_clauses) if where_clauses else "1=1"

    # 获取总数
    count_row = fetchone(f"SELECT COUNT(*) as cnt FROM models m WHERE {where_sql}", tuple(params))
    total = count_row["cnt"] if count_row else 0

    # 获取列表
    params.extend([limit, offset])
    rows = fetchall(f"""
        SELECT m.*, mt.display_name as model_type_name, mt.type_name
        FROM models m
        LEFT JOIN model_types mt ON m.model_type_id = mt.id
        WHERE {where_sql}
        ORDER BY m.updated_at DESC
        LIMIT %s OFFSET %s
    """, tuple(params))

    return {"models": rows or [], "total": total}


def delete_model(model_id: int, delete_file: bool = False) -> dict:
    """删除模型记录（可选删除文件）。"""
    if not use_mysql():
        return {"error": "需要 MySQL 支持"}

    model = fetchone("SELECT * FROM models WHERE id = %s", (model_id,))
    if not model:
        return {"error": "模型不存在"}

    file_path = model["file_path"]

    # 删除记录
    execute("DELETE FROM models WHERE id = %s", (model_id,))

    # 删除文件
    if delete_file:
        models_root = get_models_root()
        if models_root:
            full_path = Path(models_root) / file_path
            if full_path.exists():
                full_path.unlink()
                return {"message": "模型记录和文件已删除"}
            return {"message": "模型记录已删除，文件不存在"}
        return {"message": "模型记录已删除，未删除文件（未配置模型根目录）"}

    return {"message": "模型记录已删除"}


def get_model_stats() -> dict:
    """获取模型统计信息。"""
    if not use_mysql():
        return {
            "by_type": [],
            "total_count": 0,
            "total_size": 0,
            "downloads": {"total": 0, "pending": 0, "downloading": 0, "completed": 0, "failed": 0},
        }

    # 按类型统计
    type_stats = fetchall("""
        SELECT mt.display_name, mt.type_name, COUNT(m.id) as count, COALESCE(SUM(m.file_size), 0) as total_size
        FROM model_types mt
        LEFT JOIN models m ON mt.id = m.model_type_id
        WHERE mt.enabled = TRUE
        GROUP BY mt.id
        ORDER BY mt.sort_order
    """)

    # 总计
    total_row = fetchone("SELECT COUNT(*) as count, COALESCE(SUM(file_size), 0) as total_size FROM models")

    # 下载任务统计
    download_stats = fetchone("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending,
            SUM(CASE WHEN status = 'downloading' THEN 1 ELSE 0 END) as downloading,
            SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM model_downloads
        WHERE created_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
    """)

    return {
        "by_type": type_stats or [],
        "total_count": total_row["count"] if total_row else 0,
        "total_size": total_row["total_size"] if total_row else 0,
        "downloads": download_stats or {},
    }
