"""
工作流模板 API - 管理、执行、查询工作流模板。

Workflow Template Management API:
- POST   /api/workflows           - 创建模板
- GET    /api/workflows           - 列出所有模板
- GET    /api/workflows/{id}      - 获取模板详情
- PUT    /api/workflows/{id}      - 更新模板
- DELETE /api/workflows/{id}      - 删除模板
- POST   /api/workflows/{id}/execute - 执行工作流
- GET    /api/workflows/{id}/api-docs - 生成 API 文档

Execution API:
- GET    /api/workflows/executions/{id}      - 查询执行状态
- GET    /api/workflows/executions            - 执行历史
"""
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import Response
from pydantic import BaseModel
from typing import Optional, Dict, Any, List
import json
from datetime import datetime, timedelta

from app.workflow_template import (
    WorkflowTemplate, WorkflowExecution,
    create_template, get_template, list_templates, update_template, delete_template,
    inject_params_to_workflow, validate_params,
    create_execution, update_execution, get_execution, list_executions
)
from app.priority_queue import add_job  # 复用现有的优先队列
from app.config import use_mysql
from app.db import fetchone, fetchall, execute


router = APIRouter(prefix="/workflows", tags=["workflows"])


# ==================== 请求/响应模型 ====================

class CreateTemplateRequest(BaseModel):
    """创建模板请求"""
    name: str
    description: str = ""
    category: str = "default"
    input_schema: Dict[str, Any]
    output_schema: Dict[str, Any] = {}
    comfy_workflow: Dict[str, Any]
    param_mapping: Dict[str, str]


class UpdateTemplateRequest(BaseModel):
    """更新模板请求"""
    name: Optional[str] = None
    description: Optional[str] = None
    category: Optional[str] = None
    input_schema: Optional[Dict[str, Any]] = None
    output_schema: Optional[Dict[str, Any]] = None
    comfy_workflow: Optional[Dict[str, Any]] = None
    param_mapping: Optional[Dict[str, str]] = None
    enabled: Optional[bool] = None


class ExecuteWorkflowRequest(BaseModel):
    """执行工作流请求"""
    params: Dict[str, Any]
    client_id: Optional[str] = None
    priority: int = 0


# ==================== 模板管理 API ====================

@router.post("")
async def create_workflow_template(req: CreateTemplateRequest):
    """
    创建新的工作流模板

    创建后自动生成唯一的 template_id，可用于后续的执行和查询。
    """
    template = WorkflowTemplate(
        name=req.name,
        description=req.description,
        category=req.category,
        input_schema=req.input_schema,
        output_schema=req.output_schema,
        comfy_workflow=req.comfy_workflow,
        param_mapping=req.param_mapping
    )
    created = create_template(template)
    return created


@router.get("")
async def list_workflow_templates(
    category: Optional[str] = Query(None),
    enabled_only: bool = Query(True)
):
    """
    列出所有工作流模板

    支持按 category 过滤，默认只显示启用的模板。
    """
    templates = list_templates(category=category, enabled_only=enabled_only)
    return {
        "templates": templates,
        "total": len(templates)
    }


@router.get("/{template_id}")
async def get_workflow_template(template_id: str):
    """
    获取单个工作流模板详情

    返回完整的模板定义，包括 input_schema、comfy_workflow、param_mapping 等。
    """
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")
    return template


@router.put("/{template_id}")
async def update_workflow_template(template_id: str, req: UpdateTemplateRequest):
    """
    更新工作流模板

    支持部分更新，version 会自动递增。
    """
    existing = get_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")

    # 合并更新
    update_data = req.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(existing, key, value)

    success = update_template(template_id, existing)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to update template")

    return get_template(template_id)


@router.delete("/{template_id}")
async def delete_workflow_template(template_id: str):
    """
    删除工作流模板

    删除后无法恢复，已执行的记录会保留。
    """
    existing = get_template(template_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Template not found")

    success = delete_template(template_id)
    if not success:
        raise HTTPException(status_code=500, detail="Failed to delete template")

    return {"message": "Template deleted"}


# ==================== 执行 API ====================

@router.post("/{template_id}/execute")
async def execute_workflow(template_id: str, req: ExecuteWorkflowRequest):
    """
    执行工作流模板

    流程：
    1. 验证输入参数
    2. 将参数注入到 ComfyUI workflow
    3. 提交到优先队列
    4. 返回 execution_id 用于查询进度

    后续可以通过：
    - GET /api/workflows/executions/{execution_id} 查询状态
    - GET /api/task/gateway/{gateway_job_id} 查询网关任务状态
    """
    # 1. 获取模板
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    if not template.enabled:
        raise HTTPException(status_code=400, detail="Template is disabled")

    # 2. 验证参数
    is_valid, error_msg = validate_params(template, req.params)
    if not is_valid:
        raise HTTPException(status_code=400, detail=error_msg)

    # 3. 注入参数到 workflow
    try:
        final_workflow = inject_params_to_workflow(template, req.params)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Parameter injection failed: {e}")

    # 4. 创建执行记录
    execution = WorkflowExecution(
        template_id=template_id,
        input_params=req.params
    )
    create_execution(execution)

    # 5. 提交到优先队列（复用现有队列系统）
    job = add_job(
        prompt=final_workflow,
        client_id=req.client_id or f"workflow_{template_id}",
        priority=req.priority
    )

    # 6. 更新执行记录
    update_execution(execution.execution_id, status="queued")

    return {
        "execution_id": execution.execution_id,
        "template_id": template_id,
        "status": "queued",
        "message": "Workflow submitted to queue"
    }


# ==================== 执行查询 API ====================

@router.get("/executions/{execution_id}")
async def get_workflow_execution(execution_id: str):
    """
    查询工作流执行状态

    返回：
    - status: queued/submitted/running/done/failed
    - progress: 执行进度 0-100
    - result_json: 执行结果（完成后）
    - error_message: 错误信息（失败时）
    """
    execution = get_execution(execution_id)
    if not execution:
        raise HTTPException(status_code=404, detail="Execution not found")

    # 如果还在 queued 状态，尝试获取网关任务状态
    if execution.status == "queued":
        from app.store import get_gateway_job
        from app.task_history import get_by_task_id

        gateway_job = get_gateway_job(execution_id)
        if gateway_job:
            # 已提交到 Worker
            task_info = get_by_task_id(execution_id)
            if task_info:
                update_execution(
                    execution_id,
                    gateway_job_id=task_info.get("task_id"),
                    prompt_id=task_info.get("prompt_id"),
                    worker_id=task_info.get("worker_id"),
                    status=task_info.get("status", "running"),
                    progress=task_info.get("progress", 0)
                )
                execution = get_execution(execution_id)  # 刷新

    return execution


@router.get("/executions")
async def list_workflow_executions(
    template_id: Optional[str] = Query(None),
    limit: int = Query(100, ge=1, le=1000)
):
    """
    列出工作流执行记录

    支持按 template_id 过滤，按创建时间倒序。
    """
    executions = list_executions(template_id=template_id, limit=limit)
    return {
        "executions": executions,
        "total": len(executions)
    }


# ==================== API 文档生成 ====================

@router.get("/{template_id}/api-docs")
async def generate_api_docs(template_id: str):
    """
    生成工作流的 API 文档

    自动生成：
    - 请求参数说明（从 input_schema 提取）
    - 响应格式说明（从 output_schema 提取）
    - 使用示例（curl、Python、JavaScript）

    可以直接复制到其他系统使用。
    """
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # 生成参数说明
    params_docs = []
    for key, defn in template.input_schema.items():
        param_doc = {
            "name": key,
            "type": defn.get("type", "string"),
            "required": defn.get("required", False),
            "description": defn.get("description", ""),
            "default": defn.get("default")
        }
        params_docs.append(param_doc)

    # 生成使用示例
    base_url = "http://localhost:8000"  # TODO: 从配置读取

    curl_example = f"""curl -X POST "{base_url}/api/workflows/{template_id}/execute" \\
  -H "Content-Type: application/json" \\
  -d '{{"params": {{}}}}'"""

    python_example = f"""import requests

response = requests.post(
    "{base_url}/api/workflows/{template_id}/execute",
    json={{"params": {{}}}}
)
execution_id = response.json()["execution_id"]
print(f"Execution ID: {{execution_id}}")

# 查询状态
status = requests.get(f"{base_url}/api/workflows/executions/{{execution_id}}")
print(status.json())"""

    js_example = f"""fetch("{base_url}/api/workflows/{template_id}/execute", {{
  method: "POST",
  headers: {{"Content-Type": "application/json"}},
  body: JSON.stringify({{params: {{}}}})
}})
.then(res => res.json())
.then(data => {{
  console.log("Execution ID:", data.execution_id);

  // 查询状态
  return fetch(`{base_url}/api/workflows/executions/${{data.execution_id}}`);
}})
.then(res => res.json())
.then(status => console.log("Status:", status));"""

    return {
        "template_id": template_id,
        "template_name": template.name,
        "description": template.description,
        "category": template.category,
        "endpoints": {
            "execute": {
                "method": "POST",
                "url": f"/api/workflows/{template_id}/execute",
                "description": "执行工作流",
                "request_body": {
                    "params": "object (必需，参数键值对)",
                    "client_id": "string (可选，客户端ID)",
                    "priority": "integer (可选，优先级，默认0)"
                },
                "response": {
                    "execution_id": "执行ID",
                    "template_id": "模板ID",
                    "status": "状态 (queued/submitted/running/done/failed)",
                    "message": "提示信息"
                }
            },
            "query_status": {
                "method": "GET",
                "url": f"/api/workflows/executions/{{execution_id}}",
                "description": "查询执行状态",
                "response": {
                    "execution_id": "执行ID",
                    "template_id": "模板ID",
                    "status": "状态",
                    "progress": "进度 (0-100)",
                    "result_json": "执行结果",
                    "error_message": "错误信息"
                }
            }
        },
        "parameters": params_docs,
        "examples": {
            "curl": curl_example,
            "python": python_example,
            "javascript": js_example
        }
    }


# ==================== 新增功能 API ====================

class BatchOperationRequest(BaseModel):
    """批量操作请求"""
    template_ids: List[str]
    action: str  # enable/disable/delete


@router.post("/batch")
async def batch_operation(req: BatchOperationRequest):
    """
    批量操作工作流模板

    支持的操作：
    - enable: 批量启用
    - disable: 批量禁用
    - delete: 批量删除
    """
    results = {"success": [], "failed": []}

    for template_id in req.template_ids:
        try:
            if req.action == "enable":
                update_template(template_id, WorkflowTemplate(enabled=True))
            elif req.action == "disable":
                update_template(template_id, WorkflowTemplate(enabled=False))
            elif req.action == "delete":
                delete_template(template_id)
            else:
                raise HTTPException(status_code=400, detail=f"Unknown action: {req.action}")

            results["success"].append(template_id)
        except Exception as e:
            results["failed"].append({"id": template_id, "error": str(e)})

    return results


@router.post("/{template_id}/copy")
async def copy_template(template_id: str):
    """
    复制工作流模板

    创建一个副本，名称会自动添加 "(副本)" 后缀。
    """
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    # 创建副本
    new_template = WorkflowTemplate(
        name=f"{template.name} (副本)",
        description=template.description,
        category=template.category,
        input_schema=template.input_schema,
        output_schema=template.output_schema,
        comfy_workflow=template.comfy_workflow,
        param_mapping=template.param_mapping,
        enabled=False  # 副本默认禁用
    )

    created = create_template(new_template)
    return created


@router.get("/{template_id}/export")
async def export_template(template_id: str):
    """
    导出工作流模板为 JSON

    返回完整的模板定义，可用于备份或分享。
    """
    template = get_template(template_id)
    if not template:
        raise HTTPException(status_code=404, detail="Template not found")

    export_data = {
        "version": "1.0",
        "exported_at": datetime.now().isoformat(),
        "template": template.model_dump()
    }

    return Response(
        content=json.dumps(export_data, ensure_ascii=False, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f'attachment; filename="{template.name}_{template_id}.json"'
        }
    )


@router.post("/import")
async def import_template(req: dict):
    """
    导入工作流模板

    从导出的 JSON 文件导入模板。
    请求体：{"data": <导出的JSON内容>}
    """
    if "data" not in req:
        raise HTTPException(status_code=400, detail="Missing 'data' field")

    try:
        import_data = req["data"]
        if isinstance(import_data, str):
            import_data = json.loads(import_data)

        # 兼容新旧格式
        if "template" in import_data:
            template_data = import_data["template"]
        else:
            template_data = import_data

        # 生成新 ID（避免冲突）
        template_data["id"] = f"wf_{uuid.uuid4().hex[:8]}"

        template = WorkflowTemplate(**template_data)
        created = create_template(template)

        return {
            "message": "Template imported successfully",
            "template_id": created.id,
            "template_name": created.name
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")


@router.get("/categories/list")
async def list_categories():
    """
    列出所有工作流分类

    返回系统中所有使用的分类及其模板数量。
    """
    if not use_mysql():
        return {"categories": []}

    rows = fetchall("""
        SELECT category, COUNT(*) as count, SUM(CASE WHEN enabled THEN 1 ELSE 0 END) as enabled_count
        FROM workflow_templates
        GROUP BY category
        ORDER BY category
    """)

    categories = [
        {
            "name": row["category"],
            "total": row["count"],
            "enabled": row["enabled_count"]
        }
        for row in rows
    ]

    return {"categories": categories}


@router.get("/stats/summary")
async def get_stats():
    """
    获取工作流统计摘要

    返回模板数量、执行数量、成功率等统计数据。
    """
    if not use_mysql():
        return {
            "total_templates": 0,
            "enabled_templates": 0,
            "total_executions": 0,
            "success_rate": 0
        }

    # 模板统计
    template_stats = fetchone("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN enabled THEN 1 ELSE 0 END) as enabled
        FROM workflow_templates
    """)

    # 执行统计
    execution_stats = fetchone("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as success,
            SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed
        FROM workflow_executions
        WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
    """)

    total_executions = execution_stats["total"] or 0
    success_count = execution_stats["success"] or 0
    success_rate = (success_count / total_executions * 100) if total_executions > 0 else 0

    return {
        "total_templates": template_stats["total"] or 0,
        "enabled_templates": template_stats["enabled"] or 0,
        "total_executions_30d": total_executions,
        "success_rate_30d": round(success_rate, 2),
        "success_count_30d": success_count,
        "failed_count_30d": execution_stats["failed"] or 0
    }


@router.get("/{template_id}/executions/history")
async def get_template_execution_history(
    template_id: str,
    limit: int = Query(20, ge=1, le=100)
):
    """
    获取特定模板的执行历史

    返回最近 N 条执行记录，用于分析模板使用情况。
    """
    if not use_mysql():
        return {"executions": [], "total": 0}

    rows = fetchall("""
        SELECT * FROM workflow_executions
        WHERE template_id = %s
        ORDER BY created_at DESC
        LIMIT %s
    """, (template_id, limit))

    executions = []
    for row in rows:
        executions.append({
            "execution_id": row["execution_id"],
            "status": row["status"],
            "progress": row["progress"],
            "created_at": str(row["created_at"]),
            "completed_at": str(row["completed_at"]) if row["completed_at"] else None,
            "error_message": row["error_message"]
        })

    return {"executions": executions, "total": len(executions)}
