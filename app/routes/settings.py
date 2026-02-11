from typing import Optional
from fastapi import APIRouter
from pydantic import BaseModel

from app import settings as st

router = APIRouter(prefix="/settings", tags=["settings"])


class UpdateSettingsBody(BaseModel):
    worker_auth_username: Optional[str] = None
    worker_auth_password: Optional[str] = None


@router.get("")
def get_settings():
    """GET /api/settings - 当前网关设置（全局 Worker 认证等），不返回密码明文。"""
    return st.get_settings_for_api()


@router.patch("")
def update_settings(body: UpdateSettingsBody):
    """PATCH /api/settings - 更新全局 Worker 认证（页面上配置）。"""
    st.set_global_worker_auth(body.worker_auth_username, body.worker_auth_password)
    return st.get_settings_for_api()
