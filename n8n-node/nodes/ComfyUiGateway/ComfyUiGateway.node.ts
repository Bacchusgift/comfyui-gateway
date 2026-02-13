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
					{ name: 'Execute（执行并等待结果）', value: 'execute', description: '提交工作流并等待完成，返回结果' },
					{ name: 'Prompt（仅提交）', value: 'prompt' },
					{ name: 'Task（任务状态）', value: 'task' },
					{ name: 'History（任务结果）', value: 'history' },
				],
				default: 'execute',
			},
			// ---- Execute: Submit and Wait ----
			{
				displayName: 'Workflow (Prompt)',
				name: 'prompt',
				type: 'json',
				default: '{}',
				required: true,
				displayOptions: { show: { resource: ['execute'] } },
				description: 'ComfyUI API 格式的工作流 JSON',
			},
			{
				displayName: 'Poll Interval (seconds)',
				name: 'pollInterval',
				type: 'number',
				default: 2,
				displayOptions: { show: { resource: ['execute'] } },
				description: '轮询状态的时间间隔（秒）',
			},
			{
				displayName: 'Timeout (seconds)',
				name: 'timeout',
				type: 'number',
				default: 300,
				displayOptions: { show: { resource: ['execute'] } },
				description: '超时时间（秒），超时后返回当前状态',
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
				description: 'ComfyUI API 格式的工作流 JSON',
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
		const apiKey = creds?.apiKey as string;
		const resource = this.getNodeParameter('resource', 0) as string;
		const operation = this.getNodeParameter('operation', 0) as string;
		const items = this.getInputData();
		const results: INodeExecutionData[] = [];

		const headers = {
			'Content-Type': 'application/json',
			Accept: 'application/json',
			'X-API-Key': apiKey,
		};

		// Sleep helper
		const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

		for (let i = 0; i < items.length; i++) {
			try {
				// ---- Execute: Submit and Wait for Result ----
				if (resource === 'execute') {
					const prompt = this.getNodeParameter('prompt', i) as object;
					const pollInterval = (this.getNodeParameter('pollInterval', i) as number) || 2;
					const timeout = (this.getNodeParameter('timeout', i) as number) || 300;

					// 1. Submit prompt
					const submitRes = await this.helpers.httpRequest({
						method: 'POST',
						url: `${baseUrl}/openapi/prompt`,
						headers,
						body: { prompt },
						json: true,
					}) as { prompt_id?: string; gateway_job_id?: string; status?: string };

					let promptId = submitRes.prompt_id;
					const gatewayJobId = submitRes.gateway_job_id;

					// If priority queue, wait for it to be submitted
					if (gatewayJobId && !promptId) {
						const startTime = Date.now();
						while (Date.now() - startTime < timeout * 1000) {
							const jobRes = await this.helpers.httpRequest({
								method: 'GET',
								url: `${baseUrl}/openapi/task/gateway/${encodeURIComponent(gatewayJobId)}`,
								headers,
								json: true,
							}) as { prompt_id?: string; status?: string };

							if (jobRes.prompt_id) {
								promptId = jobRes.prompt_id;
								break;
							}
							if (jobRes.status === 'failed') {
								results.push({ json: { error: 'Gateway job failed', gateway_job_id: gatewayJobId } });
								break;
							}
							await sleep(pollInterval * 1000);
						}
					}

					if (!promptId) {
						results.push({ json: { error: 'Failed to get prompt_id', ...submitRes } });
						continue;
					}

					// 2. Poll for status until done/failed or timeout
					const startTime = Date.now();
					let finalStatus = 'unknown';
					let progress = 0;

					while (Date.now() - startTime < timeout * 1000) {
						const statusRes = await this.helpers.httpRequest({
							method: 'GET',
							url: `${baseUrl}/openapi/task/${encodeURIComponent(promptId)}/status`,
							headers,
							json: true,
						}) as { status?: string; progress?: number };

						finalStatus = statusRes.status || 'unknown';
						progress = statusRes.progress || 0;

						if (finalStatus === 'done' || finalStatus === 'failed') {
							break;
						}

						await sleep(pollInterval * 1000);
					}

					// 3. Get history/result if done
					let history = null;
					if (finalStatus === 'done') {
						try {
							const historyRes = await this.helpers.httpRequest({
								method: 'GET',
								url: `${baseUrl}/openapi/history/${encodeURIComponent(promptId)}`,
								headers,
								json: true,
							}) as { history?: object };
							history = historyRes.history;
						} catch {
							// History not available
						}
					}

					results.push({
						json: {
							prompt_id: promptId,
							gateway_job_id: gatewayJobId,
							status: finalStatus,
							progress,
							history,
						},
					});
					continue;
				}

				// ---- Prompt: Submit ----
				if (resource === 'prompt' && operation === 'submit') {
					const prompt = this.getNodeParameter('prompt', i) as object;
					const clientId = this.getNodeParameter('clientId', i) as string | undefined;
					const priority = this.getNodeParameter('priority', i) as number | undefined;
					const body: Record<string, unknown> = { prompt };
					if (clientId !== undefined && clientId !== '') body.client_id = clientId;
					if (priority !== undefined && priority !== '') body.priority = Number(priority);
					const res = await this.helpers.httpRequest({
						method: 'POST',
						url: `${baseUrl}/openapi/prompt`,
						headers,
						body,
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}

				// ---- Task: Get Status ----
				if (resource === 'task' && operation === 'getStatus') {
					const promptId = this.getNodeParameter('promptId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/openapi/task/${encodeURIComponent(promptId)}/status`,
						headers,
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}

				// ---- Task: Get Gateway Job ----
				if (resource === 'task' && operation === 'getGatewayJob') {
					const gatewayJobId = this.getNodeParameter('gatewayJobId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/openapi/task/gateway/${encodeURIComponent(gatewayJobId)}`,
						headers,
						json: true,
					});
					results.push({ json: res as object });
					continue;
				}

				// ---- History: Get ----
				if (resource === 'history' && operation === 'get') {
					const promptId = this.getNodeParameter('promptId', i) as string;
					const res = await this.helpers.httpRequest({
						method: 'GET',
						url: `${baseUrl}/openapi/history/${encodeURIComponent(promptId)}`,
						headers,
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
