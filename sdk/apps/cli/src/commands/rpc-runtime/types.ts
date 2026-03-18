import type { RpcProviderCapability } from "@clinebot/shared";

export type StoredModelsFile = {
	version: 1;
	providers: Record<
		string,
		{
			provider: {
				name: string;
				baseUrl: string;
				defaultModelId: string;
				capabilities?: RpcProviderCapability[];
				modelsSourceUrl?: string;
			};
			models: Record<
				string,
				{
					id: string;
					name?: string;
					supportsVision?: boolean;
					supportsAttachments?: boolean;
				}
			>;
		}
	>;
};
