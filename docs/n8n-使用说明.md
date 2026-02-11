# ComfyUI Gateway n8n Workflow 使用说明

## 文件说明

| 文件 | 说明 |
|------|------|
| `n8n-comfyui-gateway-workflow.json` | 基础生图流程（立即执行模式） |
| `n8n-priority-queue-workflow.json` | 优先队列生图流程 |

---

## 快速开始

### 1. 导入 Workflow

1. 打开 n8n 界面
2. 点击右上角 **"Import from File"** 或 **"从文件导入"**
3. 选择对应的 `.json` 文件
4. 点击 **"Import"** 导入

### 2. 配置 Gateway 地址

导入后，修改 **"初始化配置"** 节点中的 `gatewayUrl`：

```
默认值: http://localhost:8000/api
改为: http://你的服务器地址:端口/api
```

### 3. 准备输入数据

Workflow 期望接收包含以下字段的 JSON：

```json
{
  "workflow": { ...ComfyUI Workflow JSON... },
  "priority": 5  // 可选，仅优先队列模式使用
}
```

### 4. 执行 Workflow

手动执行或设置触发器（Webhook、Cron、MQTT 等）

---

## 两种模式对比

### 基础模式（立即执行）

**文件**: `n8n-comfyui-gateway-workflow.json`

**特点**:
- 任务立即提交到 Worker
- 返回 `prompt_id`
- 适合简单场景

**流程图**:
```
提交任务 → 轮询状态 → 完成 → 获取结果
                    ↑
                    └─ 未完成则重试
```

**请求示例**:
```json
POST /api/prompt
{
  "prompt": { ... },
  "client_id": "n8n-20250115120000"
}

响应:
{
  "prompt_id": "abc-123-def",
  "number": 1
}
```

---

### 优先队列模式

**文件**: `n8n-priority-queue-workflow.json`

**特点**:
- 任务进入网关优先队列
- 返回 `gateway_job_id`
- 支持 `priority` 参数控制优先级
- 两个阶段轮询：网关队列 → Worker 执行

**流程图**:
```
提交到优先队列
      ↓
轮询 gateway job status
      ↓
获取 prompt_id
      ↓
轮询 task status
      ↓
完成 → 获取结果
```

**请求示例**:
```json
POST /api/prompt
{
  "prompt": { ... },
  "client_id": "n8n-priority-20250115120000",
  "priority": 5
}

响应:
{
  "gateway_job_id": "gateway-job-123",
  "status": "queued"
}
```

---

## 节点说明

### 基础模式节点

| 节点 | 功能 |
|------|------|
| 初始化配置 | 设置 gatewayUrl 和 workflow |
| 提交生图任务 | POST /api/prompt |
| 等待5秒 | 首次轮询前等待 |
| 检查任务状态 | GET /api/task/{prompt_id}/status |
| 是否完成? | 判断 status === 'done' |
| 获取任务结果 | GET /api/history/{prompt_id} |
| 提取图片URL | Code 节点，解析 history |
| 成功摘要 | 输出成功信息 |
| 下载图片[可选] | 实际下载图片文件 |
| 是否失败? | 判断 status === 'failed' |
| 失败摘要 | 输出错误信息 |
| 等待3秒后重试 | 失败/未完成时的重试延迟 |

### 优先队列模式节点

| 节点 | 功能 |
|------|------|
| 初始化配置 | 设置 gatewayUrl、workflow、priority |
| 提交到优先队列 | POST /api/prompt (带 priority) |
| 等待3秒 | 首次轮询前等待 |
| 检查网关队列状态 | GET /api/task/gateway/{gateway_job_id} |
| 已获取prompt_id? | 判断是否有 prompt_id |
| 等待5秒 | Worker 轮询延迟 |
| 检查任务执行状态 | GET /api/task/{prompt_id}/status |
| 任务完成? | 判断 status === 'done' |
| 获取任务结果 | GET /api/history/{prompt_id} |
| 提取输出URL | Code 节点，解析 history |
| 成功摘要 | 输出成功信息 |
| 任务失败? | 判断 status === 'failed' |
| 错误摘要 | 输出错误信息 |

---

## n8n 变量引用说明

在 workflow 中使用了两种变量引用方式：

### 引用上一个节点的数据
```javascript
{{ $json.field_name }}
```
用于引用**直接上一个节点**输出的 JSON 字段。

### 引用指定节点的数据
```javascript
{{ $('节点名称').item.json.field_name }}
```
用于引用**特定节点**（非上一个）输出的数据。

这在循环/分支场景中很关键，例如：
- 等待节点后需要引用更早节点保存的数据
- IF 节点的两个分支需要引用共同的初始配置

### 为什么需要 "保存xxx" 节点？

由于 n8n 中 Wait 节点会传递数据但不增加新字段，当有循环时：
- "检查任务状态" → "是否完成?" → (循环回) "等待5秒" → "检查任务状态"

此时 "检查任务状态" 无法获取 `gatewayUrl` 和 `prompt_id`，因此：
1. 提交任务后立即用 **Set** 节点保存返回的 `prompt_id`
2. 后续节点使用 `$('保存prompt_id').item.json.prompt_id` 引用

---

## 输出格式

### 成功时

```
summary: "任务完成! 生成图片数: 4 Prompt ID: abc-123-def"
```

每个图片会输出单独的 item：

```json
{
  "filename": "image_001.png",
  "subfolder": "",
  "type": "output",
  "url": "http://gateway/api/view?filename=image_001.png&subfolder=&type=output&prompt_id=abc-123",
  "prompt_id": "abc-123-def",
  "node_id": "3"
}
```

### 失败时

```
error: "任务状态: failed
消息: Not in queue and no history"
```

---

## 高级配置

### 修改轮询间隔

修改 **"等待X秒"** 节点的 `amount` 参数：

- 建议值：3-10 秒
- 频繁轮询：增加服务器负担
- 间隔过长：响应慢

### 设置重试上限

默认会无限重试，如需限制重试次数：

1. 添加 **"Counter"** 节点
2. 添加 **"IF"** 节点检查计数
3. 超过次数则终止

### 添加超时控制

在轮询节点前添加 **"Wait"** 节点 + **"Switch"** 节点：

```
开始 ──→ 记录开始时间
         ↓
      轮询检查
         ↓
    计算耗时
         ↓
    超时? ──是→ 终止
         │
        否
         ↓
      继续轮询
```

---

## 常见问题

### Q: Workflow 执行后没有输出？

A: 检查以下几点：
1. Gateway 地址是否正确
2. 是否有可用的 Worker（访问 `/api/workers` 查看）
3. Worker 状态是否健康
4. 输入的 workflow JSON 格式是否正确

### Q: 轮询一直不结束？

A: 可能原因：
1. 任务实际已失败但状态未更新
2. Worker 宕机
3. 网络问题

**解决方法**：在 **"等待X秒"** 节点后添加超时检查。

### Q: 图片 URL 无法访问？

A: 确认：
1. Gateway 服务正常运行
2. URL 中的 `prompt_id` 正确
3. Worker 上的图片文件未被清理

### Q: 如何获取 ComfyUI Workflow JSON？

A:
1. 在 ComfyUI 界面设计好工作流
2. 点击 **"Save (API Format)"** 或 **"保存 (API格式)"**
3. 复制生成的 JSON

---

## 示例触发器配置

### Webhook 触发

在 Workflow 首部添加 **"Webhook"** 节点：

```
POST /webhook/comfyui-gateway
Body (JSON):
{
  "workflow": { ... },
  "priority": 5
}
```

### Cron 定时任务

添加 **"Schedule Trigger"** 节点：

```
模式: Cron
Cron 表达式: 0 */10 * * * *  (每10分钟)
```

结合 **"Set"** 节点预设 workflow。

---

## 附录：状态码对照表

| 状态 | 说明 | 后续操作 |
|------|------|----------|
| `queued` | 在队列中等待 | 继续轮询 |
| `submitted` | 已提交到 Worker | 继续轮询 |
| `running` | 正在执行 | 继续轮询 |
| `done` | 已完成 | 获取结果 |
| `failed` | 失败 | 终止/报错 |
| `unknown` | 状态未知 | 可能需要手动检查 |
