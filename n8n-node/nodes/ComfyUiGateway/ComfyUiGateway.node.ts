import type {
	IExecuteFunctions,
	INodeExecutionData,
	INodeType,
	INodeTypeDescription,
	NodeApiError,
} from 'n8n-workflow';

export class ComfyUiGateway implements INodeType {
	description: INodeTypeDescription = {
		displayName: 'ComfyUI Gateway',
		name: 'comfyUiGateway',
		icon: 'file:comfyui-gateway.svg',
		group: ['transform'],
		version: 1,
		subtitle: '={{ $parameter["operation"] + " / " + $parameter["resource"] }}',
		description: '提交工作流、查任务状态与结果（ComfyUI 负载均衡网关）',
		defaults: { name: 'ComfyUI Gateway' },
		inputs: ['main'],
		outputs: ['main'],
		credentials: [{ name: 'comfyUiGatewayApi', required: true }],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Prompt（提交工作流）', value: 'prompt' },
					{ name: 'Task（任务状态）', value: 'task' },
					{ name: 'History（任务结果）', value: 'history' },
				],
				default: 'prompt',
			},
			// ---- Prompt: Submit ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['prompt'] } },
				options: [{ name: 'Submit', value: 'submit', description: '提交 ComfyUI 工作流 JSON' }],
				default: 'submit',
			},
			{
				displayName: 'Workflow (Prompt)',
				name: 'prompt',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: { show: { resource: ['prompt'], operation: ['submit'] } },
				description: 'ComfyUI API 格式的工作流 JSON，可从上游用 {{ $json.prompt }} 或 {{ $json }}',
			},
			{
				displayName: 'Client ID',
				name: 'clientId',
				type: 'string',
				default: '',
				displayOptions: { show: { resource: ['prompt'], operation: ['submit'] } },
				description: '可选，不填则自动生成 UUID',
			},
			{
				displayName: 'Priority（插队）',
				name: 'priority',
				type: 'number',
				default: undefined,
				displayOptions: { show: { resource: ['prompt'], operation: ['submit'] } },
				description: '可选。传入后进入网关优先级队列（数值越大越优先），返回 gateway_job_id',
			},
			// ---- Task ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['task'] } },
				options: [
					{ name: 'Get Status', value: 'getStatus', description: '按 prompt_id 查状态' },
					{ name: 'Get Gateway Job', value: 'getGatewayJob', description: '按 gateway_job_id 查插队任务' },
				],
				default: 'getStatus',
			},
			{
				displayName: 'Prompt ID',
				name: 'promptId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['task'], operation: ['getStatus'] } },
				description: '提交后返回的 prompt_id',
			},
			{
				displayName: 'Gateway Job ID',
				name: 'gatewayJobId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['task'], operation: ['getGatewayJob'] } },
				description: '带 priority 提交时返回的 gateway_job_id',
			},
			// ---- History ----
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: { show: { resource: ['history'] } },
				options: [{ name: 'Get', value: 'get', description: '获取任务结果（图片/视频带 url）' }],
				default: 'get',
			},
			{
				displayName: 'Prompt ID',
				name: 'promptId',
				type: 'string',
				default: '',
				required: true,
				displayOptions: { show: { resource: ['history'], operation: ['get'] } },
				description: '任务对应的 prompt_id',
			},
		],
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const creds = await this.getCredentials('comfyUiGatewayApi');
		const baseUrl = (creds?.baseUrl as string)?.replace(/\/$/, '') || '';
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				if (resource === 'prompt' && operation === 'submit') {
					const prompt = this.getNodeParameter('prompt', i) as object;
					const clientId = this.getNodeParameter('clientId', i) as string | undefined;
					const priority = this.getNodeParameter('priority', i) as number | undefined;
					const body: Record<string, unknown> = { prompt };
					if (clientId !== undefined && clientId !== '') body.client_id = clientId;
					if (priority !== undefined && priority !== '') body.priority = Number(priority);
					const res = await this.helpers.httpRequest({
						method: 'POST',
						url: `${baseUrl}/api/prompt`,
						headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
						body,
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}
				if (resource === 'task' && operation === 'getStatus') {
					const promptId = this.getNodeParameter('promptId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/api/task/${encodeURIComponent(promptId)}/status`,
						headers: { Accept: 'application/json' },
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}
				if (resource === 'task' && operation === 'getGatewayJob') {
					const gatewayJobId = this.getNodeParameter('gatewayJobId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/api/task/gateway/${encodeURIComponent(gatewayJobId)}`,
						headers: { Accept: 'application/json' },
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}
				if (resource === 'history' && operation === 'get') {
					const promptId = this.getNodeParameter('promptId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/api/history/${encodeURIComponent(promptId)}`,
						headers: { Accept: 'application/json' },
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}
				results.push({ json: { error: 'Unknown resource/operation' } });
			} catch (err) {
				const nodeError = err as NodeApiError;
				if (this.continueOnFail()) {
					results.push({ json: { error: nodeError.message || String(err) } });
				} else {
					throw err;
				}
			}
		}
		return [results];
	}
}
