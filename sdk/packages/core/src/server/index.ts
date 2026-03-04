/**
 * @cline/core/server
 *
 * Node/runtime services for host applications (CLI, desktop runtime, servers).
 */

export type {
	AgentConfigWatcher,
	AgentConfigWatcherEvent,
	AgentYamlConfig,
	BuildAgentConfigOverridesOptions,
	CreateAgentConfigWatcherOptions,
	CreateInstructionWatcherOptions,
	CreateRulesConfigDefinitionOptions,
	CreateSkillsConfigDefinitionOptions,
	CreateUserInstructionConfigWatcherOptions,
	CreateWorkflowsConfigDefinitionOptions,
	HookConfigFileEntry,
	ParseMarkdownFrontmatterResult,
	ParseYamlFrontmatterResult,
	RuleConfig,
	SkillConfig,
	UnifiedConfigDefinition,
	UnifiedConfigFileCandidate,
	UnifiedConfigFileContext,
	UnifiedConfigRecord,
	UnifiedConfigWatcherEvent,
	UnifiedConfigWatcherOptions,
	UserInstructionConfig,
	UserInstructionConfigType,
	UserInstructionConfigWatcher,
	UserInstructionConfigWatcherEvent,
	WorkflowConfig,
} from "../agents";
export {
	createAgentConfigDefinition,
	createAgentConfigWatcher,
	createRulesConfigDefinition,
	createSkillsConfigDefinition,
	createUserInstructionConfigWatcher,
	createWorkflowsConfigDefinition,
	DOCUMENTS_HOOKS_DIRECTORY_PATH,
	DOCUMENTS_RULES_DIRECTORY_PATH,
	DOCUMENTS_WORKFLOWS_DIRECTORY_PATH,
	HOOK_CONFIG_FILE_EVENT_MAP,
	HOOKS_CONFIG_DIRECTORY_NAME,
	HookConfigFileName,
	listHookConfigFiles,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentTools,
	resolveHooksConfigSearchPaths,
	resolveRulesConfigSearchPaths,
	resolveSkillsConfigSearchPaths,
	resolveWorkflowsConfigSearchPaths,
	SKILLS_CONFIG_DIRECTORY_NAME,
	toHookConfigFileName,
	toPartialAgentConfig,
	UnifiedConfigFileWatcher,
	WORKFLOWS_CONFIG_DIRECTORY_NAME,
} from "../agents";
export {
	createOAuthClientCallbacks,
	type OAuthClientCallbacksOptions,
} from "../auth/client";
export {
	createClineOAuthProvider,
	getValidClineCredentials,
	loginClineOAuth,
	refreshClineToken,
} from "../auth/cline";
export {
	getValidOpenAICodexCredentials,
	isOpenAICodexTokenExpired,
	loginOpenAICodex,
	normalizeOpenAICodexCredentials,
	openaiCodexOAuthProvider,
	refreshOpenAICodexToken,
} from "../auth/codex";
export {
	createOcaOAuthProvider,
	createOcaRequestHeaders,
	DEFAULT_EXTERNAL_IDCS_CLIENT_ID,
	DEFAULT_EXTERNAL_IDCS_SCOPES,
	DEFAULT_EXTERNAL_IDCS_URL,
	DEFAULT_EXTERNAL_OCA_BASE_URL,
	DEFAULT_INTERNAL_IDCS_CLIENT_ID,
	DEFAULT_INTERNAL_IDCS_SCOPES,
	DEFAULT_INTERNAL_IDCS_URL,
	DEFAULT_INTERNAL_OCA_BASE_URL,
	generateOcaOpcRequestId,
	getValidOcaCredentials,
	loginOcaOAuth,
	OCI_HEADER_OPC_REQUEST_ID,
	refreshOcaToken,
} from "../auth/oca";
export { startLocalOAuthServer } from "../auth/server";
export type {
	OAuthCredentials,
	OAuthLoginCallbacks,
	OAuthPrompt,
	OAuthProviderInterface,
	OcaClientMetadata,
	OcaMode,
	OcaOAuthConfig,
	OcaOAuthEnvironmentConfig,
	OcaOAuthProviderOptions,
	OcaTokenResolution,
} from "../auth/types";

export type {
	FastFileIndexOptions,
	MentionEnricherOptions,
	MentionEnrichmentResult,
} from "../input";
export {
	enrichPromptWithMentions,
	getFileIndex,
	prewarmFileIndex,
} from "../input";

export type {
	LoadMcpSettingsOptions,
	McpConnectionStatus,
	McpManager,
	McpManagerOptions,
	McpServerClient,
	McpServerClientFactory,
	McpServerRegistration,
	McpServerSnapshot,
	McpServerTransportConfig,
	McpSettingsFile,
	McpSseTransportConfig,
	McpStdioTransportConfig,
	McpStreamableHttpTransportConfig,
	RegisterMcpServersFromSettingsOptions,
} from "../mcp";
export {
	hasMcpSettingsFile,
	InMemoryMcpManager,
	loadMcpSettingsFile,
	registerMcpServersFromSettingsFile,
	resolveDefaultMcpSettingsPath,
	resolveMcpServerRegistrations,
} from "../mcp";

export {
	formatRulesForSystemPrompt,
	isRuleEnabled,
	listEnabledRulesFromWatcher,
	loadRulesForSystemPromptFromWatcher,
} from "../runtime/rules";
export {
	createTeamName,
	DefaultRuntimeBuilder,
} from "../runtime/runtime-builder";
export type {
	BuiltRuntime,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "../runtime/session-runtime";
export { requestDesktopToolApproval } from "../runtime/tool-approval";
export type { AvailableWorkflow } from "../runtime/workflows";
export {
	listAvailableWorkflowsFromWatcher,
	resolveWorkflowSlashCommandFromWatcher,
} from "../runtime/workflows";

export { RpcCoreSessionService } from "../session/rpc-session-service";
export {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "../session/session-graph";
export type { SessionManager } from "../session/session-manager";
export type { SessionManifest } from "../session/session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "../session/session-service";
export { CoreSessionService } from "../session/session-service";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "../session/workspace-manager";
export { InMemoryWorkspaceManager } from "../session/workspace-manager";
export type { WorkspaceManifest } from "../session/workspace-manifest";
export {
	emptyWorkspaceManifest,
	generateWorkspaceInfo,
	normalizeWorkspacePath,
	upsertWorkspaceInfo,
	WorkspaceInfoSchema,
	WorkspaceManifestSchema,
} from "../session/workspace-manifest";

export {
	resolveClineDataDir,
	resolveProviderSettingsPath,
	resolveSessionDataDir,
} from "../storage/paths";
export {
	type MigrateLegacyProviderSettingsOptions,
	type MigrateLegacyProviderSettingsResult,
	migrateLegacyProviderSettings,
} from "../storage/provider-settings-legacy-migration";
export { ProviderSettingsManager } from "../storage/provider-settings-manager";
export { SqliteSessionStore } from "../storage/sqlite-session-store";

export type { SessionStatus } from "../types/common";
export { SessionSource } from "../types/common";
export type {
	CoreAgentMode,
	CoreModelConfig,
	CoreRuntimeFeatures,
	CoreSessionConfig,
} from "../types/config";
export type { WorkspaceInfo } from "../types/workspace";
