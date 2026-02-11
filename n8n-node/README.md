# n8n node: ComfyUI Gateway

n8n 自定义节点，用于对接 [ComfyUI 负载均衡网关](https://github.com/Bacchusgift/comfyui-gateway)：提交工作流、查询任务状态与获取结果。

## 安装

### 在 n8n 中安装（社区节点）

1. 打开 n8n → **Settings** → **Community nodes** → **Install**  
2. 输入包名：`n8n-nodes-comfyui-gateway`，或先发布到 npm 后在此安装。

### 本地开发 / 未发布时

```bash
cd n8n-node
npm install
npm run build
npm link
# 在 n8n 的 custom 节点目录下链接（例如 ~/.n8n/custom）
cd ~/.n8n/custom && npm link n8n-nodes-comfyui-gateway
```

然后重启 n8n，在节点面板中搜索 **ComfyUI Gateway**。

## 凭证

- **ComfyUI Gateway API**：只需填写 **Gateway Base URL**（例如 `https://your-gateway.example.com`），不要带结尾斜杠。  
- 若网关前有 Basic 认证，可在请求头或 n8n 的 HTTP 选项中另行配置。

## 节点能力

| Resource | Operation | 说明 |
|----------|-----------|------|
| **Prompt** | Submit | 提交 ComfyUI 工作流 JSON。可填 **Workflow (Prompt)**、可选 **Client ID**、可选 **Priority**（插队时返回 `gateway_job_id`，需用 Task → Get Gateway Job 轮询）。 |
| **Task** | Get Status | 按 `prompt_id` 查询任务状态（queued / running / done / failed）。 |
| **Task** | Get Gateway Job | 按 `gateway_job_id` 查询插队任务状态，返回中含 `prompt_id`。 |
| **History** | Get | 按 `prompt_id` 获取任务结果；网关会在图片/视频等资源上注入可直接使用的 `url` 字段。 |

## 典型流程

1. **ComfyUI Gateway (Prompt – Submit)**：提交工作流，得到 `prompt_id`（或带 priority 时得到 `gateway_job_id`）。  
2. 若为插队任务：**ComfyUI Gateway (Task – Get Gateway Job)** 轮询直到返回 `prompt_id` 且状态为 running/done。  
3. **ComfyUI Gateway (Task – Get Status)**：按 `prompt_id` 轮询，直到 `status === "done"`。  
4. **ComfyUI Gateway (History – Get)**：按 `prompt_id` 取结果，使用 `outputs[node_id].images[i].url` 等。

## 构建与发布

```bash
npm install
npm run build
# 发布到 npm（需先登录 npm）
npm publish
```

## 协议

MIT
