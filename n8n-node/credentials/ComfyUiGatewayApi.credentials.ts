import type { ICredentialTestRequest, ICredentialType, INodeProperties } from 'n8n-workflow';

export class ComfyUiGatewayApi implements ICredentialType {
	name = 'comfyUiGatewayApi';

	displayName = 'ComfyUI Gateway API';

	documentationUrl = 'https://github.com/Bacchusgift/comfyui-gateway';

	properties: INodeProperties[] = [
		{
			displayName: 'Gateway Base URL',
			name: 'baseUrl',
			type: 'string',
			default: '',
			placeholder: 'https://your-gateway.example.com',
			description: 'ComfyUI Gateway 根地址（不要带结尾斜杠）',
			required: true,
		},
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: { password: true },
			default: '',
			placeholder: 'cg_xxxxx',
			description: '从网关管理后台生成的 API Key',
			required: true,
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{ $credentials.baseUrl }}',
			url: '/openapi/queue',
			headers: {
				'X-API-Key': '={{ $credentials.apiKey }}',
			},
		},
	};
}
