"""
初始化示例工作流模板

运行方式：
- 直接运行: python scripts/init_workflows.py
- 或在容器内运行: docker compose exec web python scripts/init_workflows.py
"""
import sys
import os

# 添加项目根目录到 Python 路径
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.workflow_template import create_template

# 示例：文生图工作流模板
TXT2IMG_TEMPLATE = {
    "name": "文生图",
    "description": "使用 Stable Diffusion 生成图片，支持提示词、负提示词、尺寸、步数等参数",
    "category": "文生图",
    "input_schema": {
        "prompt": {
            "type": "string",
            "required": True,
            "description": "提示词，描述你想要生成的图片内容"
        },
        "negative_prompt": {
            "type": "string",
            "required": False,
            "default": "",
            "description": "负提示词，描述你不想要的内容"
        },
        "width": {
            "type": "integer",
            "required": False,
            "default": 1024,
            "description": "图片宽度"
        },
        "height": {
            "type": "integer",
            "required": False,
            "default": 1024,
            "description": "图片高度"
        },
        "steps": {
            "type": "integer",
            "required": False,
            "default": 20,
            "description": "采样步数"
        },
        "cfg_scale": {
            "type": "number",
            "required": False,
            "default": 7.0,
            "description": "CFG 强度"
        },
        "seed": {
            "type": "integer",
            "required": False,
            "default": -1,
            "description": "随机种子，-1 表示随机"
        }
    },
    "output_schema": {
        "images": {
            "type": "array",
            "description": "生成的图片列表"
        }
    },
    # 这里需要替换为实际的 ComfyUI workflow JSON
    "comfy_workflow": {
        "example": "请从 ComfyUI 导出实际的 workflow JSON",
        "note": "需要根据实际的节点结构调整 param_mapping"
    },
    "param_mapping": {
        "prompt": "6.inputs.text",
        "negative_prompt": "7.inputs.text",
        "width": "5.inputs.width",
        "height": "5.inputs.height",
        "steps": "4.inputs.steps",
        "cfg_scale": "4.inputs.cfg",
        "seed": "3.inputs.seed"
    }
}

# 示例：图编辑工作流模板
IMG2IMG_TEMPLATE = {
    "name": "图编辑",
    "description": "基于输入图片进行编辑，支持 img2img、inpaint 等功能",
    "category": "图编辑",
    "input_schema": {
        "input_image": {
            "type": "string",
            "required": True,
            "description": "输入图片的 URL 或 base64"
        },
        "prompt": {
            "type": "string",
            "required": True,
            "description": "编辑提示词"
        },
        "denoising_strength": {
            "type": "number",
            "required": False,
            "default": 0.75,
            "description": "去噪强度，0-1 之间"
        }
    },
    "output_schema": {
        "images": {
            "type": "array",
            "description": "编辑后的图片"
        }
    },
    "comfy_workflow": {},
    "param_mapping": {
        "prompt": "6.inputs.text",
        "denoising_strength": "10.inputs.denoise"
    }
}

# 示例：图生视频工作流模板
IMG2VIDEO_TEMPLATE = {
    "name": "图生视频",
    "description": "将图片转换为视频片段",
    "category": "图生视频",
    "input_schema": {
        "input_image": {
            "type": "string",
            "required": True,
            "description": "输入图片的 URL 或 base64"
        },
        "duration": {
            "type": "number",
            "required": False,
            "default": 4.0,
            "description": "视频时长（秒）"
        },
        "fps": {
            "type": "integer",
            "required": False,
            "default": 8,
            "description": "帧率"
        },
        "motion_bucket_id": {
            "type": "integer",
            "required": False,
            "default": 127,
            "description": "运动强度，1-255"
        }
    },
    "output_schema": {
        "video": {
            "type": "string",
            "description": "生成的视频文件路径或 URL"
        }
    },
    "comfy_workflow": {},
    "param_mapping": {
        "duration": "5.inputs.duration",
        "fps": "5.inputs.fps",
        "motion_bucket_id": "5.inputs.motion_bucket"
    }
}


def init_workflows():
    """初始化示例工作流模板"""
    print("正在初始化工作流模板...")

    templates = [
        TXT2IMG_TEMPLATE,
        IMG2IMG_TEMPLATE,
        IMG2VIDEO_TEMPLATE
    ]

    for tmpl_data in templates:
        try:
            from app.workflow_template import WorkflowTemplate
            template = WorkflowTemplate(**tmpl_data)
            created = create_template(template)
            print(f"✓ 创建模板: {created.name} (ID: {created.id})")
        except Exception as e:
            print(f"✗ 创建模板失败 {tmpl_data['name']}: {e}")

    print("\n初始化完成！")
    print("\n注意：")
    print("1. 这些模板使用的是示例参数映射，需要根据你的 ComfyUI workflow 调整")
    print("2. 在 ComfyUI 中设计好 workflow 后，导出 API JSON")
    print("3. 将 comfy_workflow 字段替换为实际 JSON")
    print("4. 根据节点编号调整 param_mapping")
    print("\n可以通过管理界面或 API 更新模板")


if __name__ == "__main__":
    init_workflows()
