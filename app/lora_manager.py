"""
LoRA 管理模块
提供 LoRA 的数据库表创建、CRUD 操作等功能
"""

from typing import List, Dict, Any, Optional
from datetime import datetime
from pathlib import Path
import os

from app.db import execute, fetchone, fetchall
from app.config import use_mysql, COMFYUI_MODELS_ROOT


def ensure_tables():
    """确保 LoRA 管理相关表存在。"""
    if not use_mysql():
        print("[lora_manager] 未配置 MySQL，跳过表创建")
        return

    try:
        # LoRA 主表
        execute("""
            CREATE TABLE IF NOT EXISTS loras (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lora_name VARCHAR(255) NOT NULL UNIQUE COMMENT 'LoRA 文件名或唯一标识',
                display_name VARCHAR(255) DEFAULT NULL COMMENT '显示名称',
                description TEXT DEFAULT NULL COMMENT '功能描述',
                priority INT DEFAULT 0 COMMENT '优先级，用于排序',
                enabled BOOLEAN DEFAULT TRUE COMMENT '是否启用',
                file_size BIGINT DEFAULT 0 COMMENT '文件大小（字节）',
                civitai_model_id VARCHAR(64) DEFAULT NULL COMMENT 'Civitai 模型 ID',
                civitai_version_id VARCHAR(64) DEFAULT NULL COMMENT 'Civitai 版本 ID',
                civitai_preview_url VARCHAR(512) DEFAULT NULL COMMENT 'Civitai 预览图 URL',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                INDEX idx_enabled (enabled),
                INDEX idx_priority (priority)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='LoRA 主表'
        """)

        # LoRA 用户关键词表
        execute("""
            CREATE TABLE IF NOT EXISTS lora_keywords (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lora_id INT NOT NULL,
                keyword VARCHAR(128) NOT NULL COMMENT '用户关键词',
                weight DECIMAL(3,2) DEFAULT 1.00 COMMENT '权重，用于匹配度计算',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
                INDEX idx_lora_id (lora_id),
                INDEX idx_keyword (keyword)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='LoRA 用户关键词表'
        """)

        # LoRA 基模关联表（多对多）
        execute("""
            CREATE TABLE IF NOT EXISTS lora_base_models (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lora_id INT NOT NULL,
                base_model_name VARCHAR(128) DEFAULT NULL COMMENT '基模名称，如 SD 1.5, SDXL',
                base_model_filename VARCHAR(255) DEFAULT NULL COMMENT '基模文件名',
                compatible BOOLEAN DEFAULT TRUE COMMENT '是否兼容',
                notes TEXT DEFAULT NULL COMMENT '备注',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
                INDEX idx_lora_id (lora_id),
                INDEX idx_base_model_name (base_model_name),
                INDEX idx_base_model_filename (base_model_filename)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='LoRA 基模关联表'
        """)

        # LoRA 触发词表
        execute("""
            CREATE TABLE IF NOT EXISTS lora_trigger_words (
                id INT AUTO_INCREMENT PRIMARY KEY,
                lora_id INT NOT NULL,
                trigger_word VARCHAR(255) NOT NULL COMMENT '触发词',
                weight DECIMAL(3,2) DEFAULT 1.00 COMMENT '权重',
                is_negative BOOLEAN DEFAULT FALSE COMMENT '是否为负向触发词',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (lora_id) REFERENCES loras(id) ON DELETE CASCADE,
                INDEX idx_lora_id (lora_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            COMMENT='LoRA 触发词表'
        """)

        print("[lora_manager] LoRA 表初始化完成")
    except Exception as e:
        print(f"[lora_manager] 表初始化失败: {e}")


# ==================== LoRA CRUD 操作 ====================

def list_loras(
    enabled_only: bool = False,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
) -> List[Dict[str, Any]]:
    """
    获取 LoRA 列表

    Args:
        enabled_only: 是否只返回启用的 LoRA
        search: 搜索关键词（匹配 lora_name 或 display_name）
        limit: 返回数量限制
        offset: 偏移量

    Returns:
        LoRA 列表，每个元素包含统计信息
    """
    conditions = []
    params = []

    if enabled_only:
        conditions.append("enabled = %s")
        params.append(True)

    if search:
        conditions.append("(lora_name LIKE %s OR display_name LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    # 主查询
    sql = f"""
        SELECT
            l.*,
            (SELECT COUNT(*) FROM lora_keywords lk WHERE lk.lora_id = l.id) as keyword_count,
            (SELECT COUNT(*) FROM lora_base_models lbm WHERE lbm.lora_id = l.id) as base_model_count,
            (SELECT COUNT(*) FROM lora_trigger_words lt WHERE lt.lora_id = l.id) as trigger_word_count
        FROM loras l
        WHERE {where_clause}
        ORDER BY l.priority DESC, l.id DESC
        LIMIT %s OFFSET %s
    """

    params.extend([limit, offset])
    return fetchall(sql, tuple(params))


def count_loras(
    enabled_only: bool = False,
    search: Optional[str] = None
) -> int:
    """统计 LoRA 数量"""
    conditions = []
    params = []

    if enabled_only:
        conditions.append("enabled = %s")
        params.append(True)

    if search:
        conditions.append("(lora_name LIKE %s OR display_name LIKE %s)")
        params.extend([f"%{search}%", f"%{search}%"])

    where_clause = " AND ".join(conditions) if conditions else "1=1"

    result = fetchone(f"SELECT COUNT(*) as count FROM loras WHERE {where_clause}", tuple(params))
    return result["count"] if result else 0


def get_lora(lora_id: int) -> Optional[Dict[str, Any]]:
    """获取单个 LoRA 详情"""
    sql = """
        SELECT
            l.*,
            (SELECT COUNT(*) FROM lora_keywords lk WHERE lk.lora_id = l.id) as keyword_count,
            (SELECT COUNT(*) FROM lora_base_models lbm WHERE lbm.lora_id = l.id) as base_model_count,
            (SELECT COUNT(*) FROM lora_trigger_words lt WHERE lt.lora_id = l.id) as trigger_word_count
        FROM loras l
        WHERE l.id = %s
    """
    return fetchone(sql, (lora_id,))


def create_lora(
    lora_name: str,
    display_name: Optional[str] = None,
    description: Optional[str] = None,
    priority: int = 0,
    enabled: bool = True,
    file_size: int = 0,
    civitai_model_id: Optional[str] = None,
    civitai_version_id: Optional[str] = None,
    civitai_preview_url: Optional[str] = None
) -> int:
    """创建 LoRA，返回新创建的 ID"""
    sql = """
        INSERT INTO loras (
            lora_name, display_name, description, priority, enabled,
            file_size, civitai_model_id, civitai_version_id, civitai_preview_url
        ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """
    result = execute(sql, (
        lora_name, display_name, description, priority, enabled,
        file_size, civitai_model_id, civitai_version_id, civitai_preview_url
    ))
    return result.last_id


def update_lora(
    lora_id: int,
    lora_name: Optional[str] = None,
    display_name: Optional[str] = None,
    description: Optional[str] = None,
    priority: Optional[int] = None,
    enabled: Optional[bool] = None,
    file_size: Optional[int] = None,
    civitai_model_id: Optional[str] = None,
    civitai_version_id: Optional[str] = None,
    civitai_preview_url: Optional[str] = None
) -> bool:
    """更新 LoRA"""
    fields = []
    params = []

    if lora_name is not None:
        fields.append("lora_name = %s")
        params.append(lora_name)
    if display_name is not None:
        fields.append("display_name = %s")
        params.append(display_name)
    if description is not None:
        fields.append("description = %s")
        params.append(description)
    if priority is not None:
        fields.append("priority = %s")
        params.append(priority)
    if enabled is not None:
        fields.append("enabled = %s")
        params.append(enabled)
    if file_size is not None:
        fields.append("file_size = %s")
        params.append(file_size)
    if civitai_model_id is not None:
        fields.append("civitai_model_id = %s")
        params.append(civitai_model_id)
    if civitai_version_id is not None:
        fields.append("civitai_version_id = %s")
        params.append(civitai_version_id)
    if civitai_preview_url is not None:
        fields.append("civitai_preview_url = %s")
        params.append(civitai_preview_url)

    if not fields:
        return False

    params.append(lora_id)
    sql = f"UPDATE loras SET {', '.join(fields)} WHERE id = %s"
    execute(sql, tuple(params))
    return True


def delete_lora(lora_id: int) -> bool:
    """删除 LoRA（级联删除关联的关键词、基模、触发词）"""
    sql = "DELETE FROM loras WHERE id = %s"
    execute(sql, (lora_id,))
    return True


# ==================== 关键词管理 ====================

def get_lora_keywords(lora_id: int) -> List[Dict[str, Any]]:
    """获取 LoRA 的所有关键词"""
    sql = "SELECT * FROM lora_keywords WHERE lora_id = %s ORDER BY weight DESC, id ASC"
    return fetchall(sql, (lora_id,))


def add_keyword(lora_id: int, keyword: str, weight: float = 1.0) -> int:
    """添加关键词，返回新 ID"""
    sql = "INSERT INTO lora_keywords (lora_id, keyword, weight) VALUES (%s, %s, %s)"
    result = execute(sql, (lora_id, keyword, weight))
    return result.last_id


def delete_keyword(lora_id: int, keyword_id: int) -> bool:
    """删除关键词"""
    sql = "DELETE FROM lora_keywords WHERE id = %s AND lora_id = %s"
    execute(sql, (keyword_id, lora_id))
    return True


# ==================== 基模关联管理 ====================

def get_lora_base_models(lora_id: int) -> List[Dict[str, Any]]:
    """获取 LoRA 的所有基模关联"""
    sql = "SELECT * FROM lora_base_models WHERE lora_id = %s ORDER BY id ASC"
    return fetchall(sql, (lora_id,))


def add_base_model(
    lora_id: int,
    base_model_name: Optional[str] = None,
    base_model_filename: Optional[str] = None,
    compatible: bool = True,
    notes: Optional[str] = None
) -> int:
    """添加基模关联，返回新 ID"""
    sql = """
        INSERT INTO lora_base_models (lora_id, base_model_name, base_model_filename, compatible, notes)
        VALUES (%s, %s, %s, %s, %s)
    """
    result = execute(sql, (lora_id, base_model_name, base_model_filename, compatible, notes))
    return result.last_id


def delete_base_model(lora_id: int, assoc_id: int) -> bool:
    """删除基模关联"""
    sql = "DELETE FROM lora_base_models WHERE id = %s AND lora_id = %s"
    execute(sql, (assoc_id, lora_id))
    return True


# ==================== 触发词管理 ====================

def get_lora_trigger_words(lora_id: int) -> List[Dict[str, Any]]:
    """获取 LoRA 的所有触发词"""
    sql = "SELECT * FROM lora_trigger_words WHERE lora_id = %s ORDER BY weight DESC, id ASC"
    return fetchall(sql, (lora_id,))


def add_trigger_word(
    lora_id: int,
    trigger_word: str,
    weight: float = 1.0,
    is_negative: bool = False
) -> int:
    """添加触发词，返回新 ID"""
    sql = "INSERT INTO lora_trigger_words (lora_id, trigger_word, weight, is_negative) VALUES (%s, %s, %s, %s)"
    result = execute(sql, (lora_id, trigger_word, weight, is_negative))
    return result.last_id


def delete_trigger_word(lora_id: int, trigger_word_id: int) -> bool:
    """删除触发词"""
    sql = "DELETE FROM lora_trigger_words WHERE id = %s AND lora_id = %s"
    execute(sql, (trigger_word_id, lora_id))
    return True


# ==================== LoRA 扫描功能 ====================

def get_loras_root() -> Optional[str]:
    """获取 LoRA 根目录（models/loras）"""
    if not COMFYUI_MODELS_ROOT:
        return None
    lora_path = Path(COMFYUI_MODELS_ROOT) / "loras"
    return str(lora_path) if lora_path.exists() else None


async def scan_loras_folder() -> Dict[str, Any]:
    """
    扫描 LoRA 文件夹并自动添加到数据库

    Returns:
        {
            "scanned": int,  # 扫描的文件数
            "added": int,    # 新增的 LoRA 数
            "updated": int,  # 更新的 LoRA 数
            "errors": list   # 错误信息
        }
    """
    if not use_mysql():
        return {"error": "需要 MySQL 支持", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    loras_root = get_loras_root()
    if not loras_root:
        return {"error": "未配置模型根目录或 loras 目录不存在", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    loras_path = Path(loras_root)
    if not loras_path.exists():
        return {"error": f"LoRA 目录不存在: {loras_root}", "scanned": 0, "added": 0, "updated": 0, "errors": []}

    # 支持的文件扩展名
    extensions = [".safetensors", ".ckpt", ".pt", ".bin", ".pth"]

    stats = {"scanned": 0, "added": 0, "updated": 0, "errors": []}

    # 递归扫描所有子目录
    for ext in extensions:
        for file_path in loras_path.glob(f"**/*{ext}"):
            stats["scanned"] += 1
            try:
                file_size = file_path.stat().st_size
                filename = file_path.name

                # 使用相对路径作为标识（相对于 loras 目录）
                relative_path = str(file_path.relative_to(loras_path))

                # 检查是否已存在（通过 lora_name）
                existing = fetchone(
                    "SELECT id, file_size FROM loras WHERE lora_name = %s",
                    (relative_path,)
                )

                if existing:
                    # 更新文件大小（如果变化）
                    if existing["file_size"] != file_size:
                        execute(
                            "UPDATE loras SET file_size = %s, updated_at = NOW() WHERE id = %s",
                            (file_size, existing["id"])
                        )
                        stats["updated"] += 1
                else:
                    # 自动生成显示名称（从文件名）
                    display_name = filename
                    # 移除扩展名
                    for ext in extensions:
                        if display_name.endswith(ext):
                            display_name = display_name[:-len(ext)]
                            break

                    # 添加新 LoRA
                    execute("""
                        INSERT INTO loras (lora_name, display_name, file_size, enabled)
                        VALUES (%s, %s, %s, TRUE)
                    """, (relative_path, display_name, file_size))
                    stats["added"] += 1

            except Exception as e:
                stats["errors"].append(f"{relative_path}: {str(e)}")

    return stats


def get_lora_file_info(lora_name: str) -> Optional[Dict[str, Any]]:
    """
    获取 LoRA 文件的详细信息

    Args:
        lora_name: LoRA 相对路径

    Returns:
        文件信息字典，包含文件路径、大小等
    """
    loras_root = get_loras_root()
    if not loras_root:
        return None

    file_path = Path(loras_root) / lora_name
    if not file_path.exists():
        return None

    try:
        stat = file_path.stat()
        return {
            "full_path": str(file_path),
            "filename": file_path.name,
            "file_size": stat.st_size,
            "modified_time": stat.st_mtime,
            "exists": True
        }
    except Exception:
        return None

