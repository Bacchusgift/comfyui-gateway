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
			description: 'ComfyUI Gateway 根地址（不要带结尾斜杠）；网关前的 Basic 认证可在请求头中另行配置',
			required: true,
		},
	];

	test: ICredentialTestRequest = {
		request: {
			baseURL: '={{ $credentials.baseUrl }}',
			url: '/api/workers',
		},
	};
}
