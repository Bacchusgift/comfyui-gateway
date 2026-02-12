"""API Key 管理模块"""
import secrets
import time
from typing import Optional, List
from app.db import get_cursor, fetchall, fetchone, execute, use_mysql
from app.config import REDIS_URL
import json

# 内存存储（当没有 MySQL 时使用）
_memory_keys: dict = {}  # {api_key: {key_id, name, created_at, last_used_at}}

def _generate_api_key() -> str:
    """生成 32 字节的随机 API Key"""
    return f"cg_{secrets.token_hex(24)}"  # cg_ 前缀 + 48 字符 = 51 字符总长度


def ensure_table():
    """确保 API Key 表存在"""
    if use_mysql():
        execute("""
            CREATE TABLE IF NOT EXISTS api_keys (
                key_id VARCHAR(36) PRIMARY KEY,
                api_key VARCHAR(64) NOT NULL UNIQUE,
                name VARCHAR(100) NOT NULL,
                created_at BIGINT NOT NULL,
                last_used_at BIGINT
            )
        """)
    elif REDIS_URL:
        # Redis 模式：表结构通过 Redis hash 模拟，无需建表
        pass
    # 纯内存模式：_memory_keys 字典已初始化


def create_key(name: str) -> dict:
    """创建新的 API Key"""
    import uuid
    key_id = str(uuid.uuid4())
    api_key = _generate_api_key()
    created_at = int(time.time())

    if use_mysql():
        execute(
            "INSERT INTO api_keys (key_id, api_key, name, created_at) VALUES (%s, %s, %s, %s)",
            (key_id, api_key, name, created_at)
        )
    elif REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL)
        r.hset("api_keys:by_key", api_key, json.dumps({
            "key_id": key_id,
            "api_key": api_key,
            "name": name,
            "created_at": created_at,
            "last_used_at": None
        }))
        r.hset("api_keys:by_id", key_id, api_key)
    else:
        _memory_keys[api_key] = {
            "key_id": key_id,
            "api_key": api_key,
            "name": name,
            "created_at": created_at,
            "last_used_at": None
        }

    return {
        "key_id": key_id,
        "api_key": api_key,
        "name": name,
        "created_at": created_at,
        "last_used_at": None
    }


def list_keys() -> List[dict]:
    """列出所有 API Key（不返回完整的 key，只返回前缀）"""
    if use_mysql():
        rows = fetchall("SELECT key_id, api_key, name, created_at, last_used_at FROM api_keys ORDER BY created_at DESC")
        result = []
        for row in rows:
            # 隐藏 key 的中间部分
            masked_key = row["api_key"][:8] + "..." + row["api_key"][-4:] if row["api_key"] else ""
            result.append({
                "key_id": row["key_id"],
                "api_key_masked": masked_key,
                "name": row["name"],
                "created_at": row["created_at"],
                "last_used_at": row["last_used_at"]
            })
        return result
    elif REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL)
        all_keys = r.hgetall("api_keys:by_key")
        result = []
        for k, v in all_keys.items():
            data = json.loads(v)
            masked_key = data["api_key"][:8] + "..." + data["api_key"][-4:] if data.get("api_key") else ""
            result.append({
                "key_id": data["key_id"],
                "api_key_masked": masked_key,
                "name": data["name"],
                "created_at": data["created_at"],
                "last_used_at": data.get("last_used_at")
            })
        return sorted(result, key=lambda x: x["created_at"], reverse=True)
    else:
        result = []
        for k, v in _memory_keys.items():
            masked_key = k[:8] + "..." + k[-4:] if k else ""
            result.append({
                "key_id": v["key_id"],
                "api_key_masked": masked_key,
                "name": v["name"],
                "created_at": v["created_at"],
                "last_used_at": v.get("last_used_at")
            })
        return sorted(result, key=lambda x: x["created_at"], reverse=True)


def delete_key(key_id: str) -> bool:
    """删除 API Key"""
    if use_mysql():
        result = fetchone("SELECT api_key FROM api_keys WHERE key_id = %s", (key_id,))
        if not result:
            return False
        execute("DELETE FROM api_keys WHERE key_id = %s", (key_id,))
        return True
    elif REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL)
        api_key = r.hget("api_keys:by_id", key_id)
        if not api_key:
            return False
        r.hdel("api_keys:by_key", api_key)
        r.hdel("api_keys:by_id", key_id)
        return True
    else:
        for k, v in list(_memory_keys.items()):
            if v["key_id"] == key_id:
                del _memory_keys[k]
                return True
        return False


def verify_key(api_key: str) -> Optional[dict]:
    """验证 API Key，返回 key 信息或 None"""
    if not api_key:
        return None

    now = int(time.time())

    if use_mysql():
        row = fetchone("SELECT key_id, name, created_at FROM api_keys WHERE api_key = %s", (api_key,))
        if row:
            # 更新最后使用时间
            execute("UPDATE api_keys SET last_used_at = %s WHERE key_id = %s", (now, row["key_id"]))
            return {
                "key_id": row["key_id"],
                "name": row["name"],
                "created_at": row["created_at"]
            }
        return None
    elif REDIS_URL:
        import redis
        r = redis.from_url(REDIS_URL)
        data = r.hget("api_keys:by_key", api_key)
        if data:
            info = json.loads(data)
            info["last_used_at"] = now
            r.hset("api_keys:by_key", api_key, json.dumps(info))
            return {
                "key_id": info["key_id"],
                "name": info["name"],
                "created_at": info["created_at"]
            }
        return None
    else:
        info = _memory_keys.get(api_key)
        if info:
            info["last_used_at"] = now
            return {
                "key_id": info["key_id"],
                "name": info["name"],
                "created_at": info["created_at"]
            }
        return None
