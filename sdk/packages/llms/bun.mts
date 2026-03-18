/// <reference types="@types/bun" />
export {};

// Only externalize published packages; bundle private workspace packages (@clinebot/shared)
const external = [
	"@ai-sdk/amazon-bedrock",
	"@ai-sdk/google-vertex",
	"@ai-sdk/mistral",
	"@anthropic-ai/sdk",
	"@aws-sdk/credential-providers",
	"@aws-sdk/client-bedrock-runtime",
	"@google/genai",
	"@streamparser/json",
	"ai",
	"ai-sdk-provider-claude-code",
	"ai-sdk-provider-codex-cli",
	"ai-sdk-provider-opencode-sdk",
	"dify-ai-provider",
	"nanoid",
	"openai",
	"zod",
];

const builds: Parameters<typeof Bun.build>[0][] = [
	{
		entrypoints: ["./src/index.ts"],
		outdir: "./dist",
		target: "node",
		external,
		minify: true,
		sourcemap: "none",
	},
	{
		entrypoints: ["./src/index.browser.ts"],
		outdir: "./dist",
		target: "browser",
		external,
		minify: true,
		sourcemap: "none",
	},
];

for (const config of builds) {
	const result = await Bun.build(config);

	if (result.logs.length > 0) {
		for (const log of result.logs) {
			console.warn(log);
		}
	}
}
