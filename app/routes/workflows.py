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
from pydantic import BaseModel
from typing import Optional, Dict, Any
import json

from app.workflow_template import (
    WorkflowTemplate, WorkflowExecution,
    create_template, get_template, list_templates, update_template, delete_template,
    inject_params_to_workflow, validate_params,
    create_execution, update_execution, get_execution, list_executions
)
from app.priority_queue import push  # 复用现有的优先队列


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
    from app.priority_queue import Job
    job = Job(
        gateway_job_id=execution.execution_id,  # 使用 execution_id 作为 gateway_job_id
        prompt=final_workflow,
        client_id=req.client_id or f"workflow_{template_id}",
        priority=req.priority
    )
    push(job)

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
