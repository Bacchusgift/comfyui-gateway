"""认证相关路由"""
import time
from typing import Optional
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
import hmac
import hashlib
import base64

from app.config import JWT_SECRET, JWT_EXPIRE_HOURS
from app.db import fetchone
from app import apikeys

router = APIRouter(prefix="/auth", tags=["auth"])


def _get_admin_credentials() -> tuple:
    """从 settings 表获取管理员账号密码"""
    username_row = fetchone("SELECT v FROM settings WHERE k = %s", ("admin_username",))
    password_row = fetchone("SELECT v FROM settings WHERE k = %s", ("admin_password",))

    username = username_row["v"] if username_row else "admin"
    password = password_row["v"] if password_row else "admin123"

    return username, password


def _generate_token(username: str, timestamp: int) -> str:
    """生成简单的 JWT-like token"""
    # 格式: base64(username:timestamp:hmac)
    payload = f"{username}:{timestamp}"
    signature = hmac.new(
        JWT_SECRET.encode(),
        payload.encode(),
        hashlib.sha256
    ).hexdigest()[:32]
    token = base64.urlsafe_b64encode(f"{payload}:{signature}".encode()).decode()
    return token


def _verify_token(token: str) -> Optional[str]:
    """验证 token，返回用户名或 None"""
    try:
        decoded = base64.urlsafe_b64decode(token.encode()).decode()
        parts = decoded.split(":")
        if len(parts) != 3:
            return None
        username, timestamp_str, signature = parts
        timestamp = int(timestamp_str)

        # 检查是否过期
        if time.time() - timestamp > JWT_EXPIRE_HOURS * 3600:
            return None

        # 验证签名
        payload = f"{username}:{timestamp}"
        expected_signature = hmac.new(
            JWT_SECRET.encode(),
            payload.encode(),
            hashlib.sha256
        ).hexdigest()[:32]

        if not hmac.compare_digest(signature, expected_signature):
            return None

        return username
    except Exception:
        return None


def get_current_user(authorization: Optional[str] = Header(None)) -> str:
    """依赖项：获取当前登录用户，未登录抛出 401"""
    if not authorization:
        raise HTTPException(status_code=401, detail="未提供认证信息")

    if authorization.startswith("Bearer "):
        token = authorization[7:]
    else:
        token = authorization

    username = _verify_token(token)
    if not username:
        raise HTTPException(status_code=401, detail="认证已过期或无效")

    return username


def verify_api_key_or_admin(x_api_key: Optional[str] = Header(None), authorization: Optional[str] = Header(None)) -> dict:
    """依赖项：验证 API Key 或管理员登录"""
    # 优先检查 API Key
    if x_api_key:
        key_info = apikeys.verify_key(x_api_key)
        if key_info:
            return {"type": "api_key", "key_id": key_info["key_id"], "name": key_info["name"]}

    # 检查管理员 token
    if authorization:
        if authorization.startswith("Bearer "):
            token = authorization[7:]
        else:
            token = authorization

        username = _verify_token(token)
        if username:
            return {"type": "admin", "username": username}

    raise HTTPException(status_code=401, detail="需要有效的 API Key 或管理员登录")


# ==================== 请求模型 ====================

class LoginBody(BaseModel):
    username: str
    password: str


class CreateApiKeyBody(BaseModel):
    name: str


# ==================== 认证接口 ====================

@router.post("/login")
def login(body: LoginBody):
    """管理员登录"""
    admin_username, admin_password = _get_admin_credentials()

    if body.username != admin_username or body.password != admin_password:
        raise HTTPException(status_code=401, detail="用户名或密码错误")

    timestamp = int(time.time())
    token = _generate_token(body.username, timestamp)

    return {
        "token": token,
        "username": body.username,
        "expires_in": JWT_EXPIRE_HOURS * 3600
    }


@router.get("/me")
def get_me(user: str = Depends(get_current_user)):
    """获取当前登录用户信息"""
    return {"username": user}


@router.post("/logout")
def logout(user: str = Depends(get_current_user)):
    """登出（客户端删除 token 即可，服务端无状态）"""
    return {"message": "登出成功"}


# ==================== API Key 管理 ====================

@router.get("/apikeys")
def list_api_keys(user: str = Depends(get_current_user)):
    """列出所有 API Key"""
    return {"keys": apikeys.list_keys()}


@router.post("/apikeys")
def create_api_key(body: CreateApiKeyBody, user: str = Depends(get_current_user)):
    """创建新的 API Key"""
    key = apikeys.create_key(body.name)
    # 返回完整的 key（只有创建时可见）
    return {
        "key_id": key["key_id"],
        "api_key": key["api_key"],
        "name": key["name"],
        "created_at": key["created_at"],
        "message": "请妥善保存 API Key，关闭后将无法再次查看完整密钥"
    }


@router.delete("/apikeys/{key_id}")
def delete_api_key(key_id: str, user: str = Depends(get_current_user)):
    """删除 API Key"""
    if not apikeys.delete_key(key_id):
        raise HTTPException(status_code=404, detail="API Key 不存在")
    return {"message": "删除成功"}
