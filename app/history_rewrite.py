"""
在 history 响应中为图片/视频等资源注入可直接使用的 gateway url，
业务侧无需再拼接 host + /view。
"""
from typing import Any
from urllib.parse import quote


# ComfyUI 里常见带 filename 的列表键名
_OUTPUT_FILE_KEYS = ("images", "gifs", "videos")


def _inject_url(obj: Any, prompt_id: str, view_base: str) -> None:
    """就地修改 obj，为含 filename 的项注入 url。view_base 如 http://gateway/api/view"""
    if not obj or not prompt_id or not view_base:
        return
    base = view_base.rstrip("/")
    if isinstance(obj, dict):
        # 单条资源：含 filename 则加 url
        if "filename" in obj and isinstance(obj.get("filename"), str):
            fn = obj["filename"]
            subfolder = obj.get("subfolder", "")
            typ = obj.get("type", "output")
            q = f"prompt_id={quote(prompt_id)}&filename={quote(fn)}&subfolder={quote(subfolder)}&type={quote(typ)}"
            obj["url"] = f"{base}?{q}"
            return
        for k, v in obj.items():
            if k in _OUTPUT_FILE_KEYS and isinstance(v, list):
                for item in v:
                    if isinstance(item, dict) and "filename" in item:
                        fn = item["filename"]
                        subfolder = item.get("subfolder", "")
                        typ = item.get("type", "output")
                        q = f"prompt_id={quote(prompt_id)}&filename={quote(fn)}&subfolder={quote(subfolder)}&type={quote(typ)}"
                        item["url"] = f"{base}?{q}"
            else:
                _inject_url(v, prompt_id, view_base)
    elif isinstance(obj, list):
        for x in obj:
            _inject_url(x, prompt_id, view_base)


def inject_history_urls(history: dict, prompt_id: str, view_base: str) -> dict:
    """
    在 history 中为所有带 filename 的图片/视频注入 url 字段。
    view_base: 网关的 view 地址，如 https://your-gateway.com/api/view
    """
    if not history or not view_base:
        return history
    _inject_url(history, prompt_id, view_base)
    return history
