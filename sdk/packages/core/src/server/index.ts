/**
 * @clinebot/core/server
 *
 * Node/runtime services for host applications (CLI, desktop runtime, servers).
 */

export {
	type ClineAccountBalance,
	type ClineAccountOperations,
	type ClineAccountOrganization,
	type ClineAccountOrganizationBalance,
	type ClineAccountOrganizationUsageTransaction,
	type ClineAccountPaymentTransaction,
	ClineAccountService,
	type ClineAccountServiceOptions,
	type ClineAccountUsageTransaction,
	type ClineAccountUser,
	executeRpcClineAccountAction,
	isRpcClineAccountActionRequest,
	RpcClineAccountService,
	type RpcProviderActionExecutor,
} from "../account";
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
	LoadAgentPluginFromPathOptions,
	ParseMarkdownFrontmatterResult,
	ParseYamlFrontmatterResult,
	ResolveAgentPluginPathsOptions,
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
	discoverPluginModulePaths,
	HOOK_CONFIG_FILE_EVENT_MAP,
	HOOKS_CONFIG_DIRECTORY_NAME,
	HookConfigFileName,
	listHookConfigFiles,
	loadAgentPluginFromPath,
	loadAgentPluginsFromPaths,
	parseAgentConfigFromYaml,
	parsePartialAgentConfigFromYaml,
	parseRuleConfigFromMarkdown,
	parseSkillConfigFromMarkdown,
	parseWorkflowConfigFromMarkdown,
	RULES_CONFIG_DIRECTORY_NAME,
	resolveAgentPluginPaths,
	resolveAgentTools,
	resolveAndLoadAgentPlugins,
	resolveDocumentsHooksDirectoryPath,
	resolveDocumentsRulesDirectoryPath,
	resolveDocumentsWorkflowsDirectoryPath,
	resolveHooksConfigSearchPaths,
	resolvePluginConfigSearchPaths,
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
export {
	ALL_DEFAULT_TOOL_NAMES,
	type AskQuestionExecutor,
	type CreateBuiltinToolsOptions,
	type CreateDefaultToolsOptions,
	createBuiltinTools,
	createDefaultExecutors,
	createDefaultTools,
	createDefaultToolsWithPreset,
	createToolPoliciesWithPreset,
	type DefaultExecutorsOptions,
	type DefaultToolName,
	DefaultToolNames,
	type DefaultToolsConfig,
	type ToolExecutors,
	type ToolPolicyPresetName,
	type ToolPresetName,
	ToolPresets,
} from "../default-tools";
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
export {
	type SandboxCallOptions,
	SubprocessSandbox,
	type SubprocessSandboxOptions,
} from "../runtime/sandbox/subprocess-sandbox";
export type {
	BuiltRuntime,
	RuntimeBuilder,
	RuntimeBuilderInput,
	SessionRuntime,
} from "../runtime/session-runtime";
export {
	type DesktopToolApprovalOptions,
	requestDesktopToolApproval,
} from "../runtime/tool-approval";
export type { AvailableWorkflow } from "../runtime/workflows";
export {
	listAvailableWorkflowsFromWatcher,
	resolveWorkflowSlashCommandFromWatcher,
} from "../runtime/workflows";
export { DefaultSessionManager } from "../session/default-session-manager";
export { RpcCoreSessionService } from "../session/rpc-session-service";
export {
	deriveSubsessionStatus,
	makeSubSessionId,
	makeTeamTaskSubSessionId,
	sanitizeSessionToken,
} from "../session/session-graph";
export type {
	CreateSessionHostOptions,
	SessionBackend,
	SessionHost,
} from "../session/session-host";
export {
	createSessionHost,
	resolveSessionBackend,
} from "../session/session-host";
export type {
	SendSessionInput,
	SessionAccumulatedUsage,
	SessionManager,
	StartSessionInput,
	StartSessionResult,
} from "../session/session-manager";
export type { SessionManifest } from "../session/session-manifest";
export type {
	CreateRootSessionWithArtifactsInput,
	RootSessionArtifacts,
} from "../session/session-service";
export { CoreSessionService } from "../session/session-service";
export {
	createSqliteRpcSessionBackend,
	SqliteRpcSessionBackend,
	type SqliteRpcSessionBackendOptions,
} from "../session/sqlite-rpc-session-backend";
export type {
	WorkspaceManager,
	WorkspaceManagerEvent,
} from "../session/workspace-manager";
export { InMemoryWorkspaceManager } from "../session/workspace-manager";
export type { WorkspaceManifest } from "../session/workspace-manifest";
export {
	buildWorkspaceMetadata,
	emptyWorkspaceManifest,
	generateWorkspaceInfo,
	normalizeWorkspacePath,
	upsertWorkspaceInfo,
	WorkspaceInfoSchema,
	WorkspaceManifestSchema,
} from "../session/workspace-manifest";
export {
	type MigrateLegacyProviderSettingsOptions,
	type MigrateLegacyProviderSettingsResult,
	migrateLegacyProviderSettings,
} from "../storage/provider-settings-legacy-migration";
export { ProviderSettingsManager } from "../storage/provider-settings-manager";
export { SqliteSessionStore } from "../storage/sqlite-session-store";
export type { SessionStatus } from "../types/common";
export { SESSION_STATUSES, SessionSource } from "../types/common";
export type {
	CoreAgentMode,
	CoreModelConfig,
	CoreRuntimeFeatures,
	CoreSessionConfig,
} from "../types/config";
export type { WorkspaceInfo } from "../types/workspace";
