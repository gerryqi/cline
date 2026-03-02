export interface WorkspaceInfo {
	rootPath: string;
	hint?: string;
	associatedRemoteUrls?: string[];
	latestGitCommitHash?: string;
	latestGitBranchName?: string;
}
