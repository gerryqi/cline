import { basename, resolve } from "node:path";
import simpleGit from "simple-git";
import { z } from "zod";
import type { WorkspaceInfo } from "../types/workspace";

export const WorkspaceInfoSchema = z.object({
	rootPath: z.string().min(1),
	hint: z.string().min(1).optional(),
	associatedRemoteUrls: z.array(z.string().min(1)).optional(),
	latestGitCommitHash: z.string().min(1).optional(),
	latestGitBranchName: z.string().min(1).optional(),
});

export const WorkspaceManifestSchema = z.object({
	currentWorkspacePath: z.string().min(1).optional(),
	workspaces: z.record(z.string().min(1), WorkspaceInfoSchema),
});

export type WorkspaceManifest = z.infer<typeof WorkspaceManifestSchema>;

export function emptyWorkspaceManifest(): WorkspaceManifest {
	return { workspaces: {} };
}

export function normalizeWorkspacePath(workspacePath: string): string {
	return resolve(workspacePath);
}

export async function generateWorkspaceInfo(
	workspacePath: string,
): Promise<WorkspaceInfo> {
	const rootPath = normalizeWorkspacePath(workspacePath);
	const info: WorkspaceInfo = {
		rootPath,
		hint: basename(rootPath),
	};

	try {
		const git = simpleGit({ baseDir: rootPath });
		const isRepo = await git.checkIsRepo();
		if (!isRepo) {
			return info;
		}

		const remotes = await git.getRemotes(true);
		if (remotes.length > 0) {
			const associatedRemoteUrls = remotes.map((remote) => {
				const remoteUrl = remote.refs.fetch || remote.refs.push;
				return `${remote.name}: ${remoteUrl}`;
			});
			info.associatedRemoteUrls = associatedRemoteUrls;
		}

		const latestGitCommitHash = (await git.revparse(["HEAD"])).trim();
		if (latestGitCommitHash.length > 0) {
			info.latestGitCommitHash = latestGitCommitHash;
		}

		const latestGitBranchName = (await git.branch()).current.trim();
		if (latestGitBranchName.length > 0) {
			info.latestGitBranchName = latestGitBranchName;
		}
	} catch {
		// Non-git workspaces keep only path + hint.
	}

	return info;
}

export function upsertWorkspaceInfo(
	manifest: WorkspaceManifest,
	info: WorkspaceInfo,
): WorkspaceManifest {
	const nextManifest: WorkspaceManifest = {
		...manifest,
		workspaces: {
			...manifest.workspaces,
			[info.rootPath]: info,
		},
	};
	if (!nextManifest.currentWorkspacePath) {
		nextManifest.currentWorkspacePath = info.rootPath;
	}
	return WorkspaceManifestSchema.parse(nextManifest);
}

export async function buildWorkspaceMetadata(cwd: string): Promise<string> {
	const workspaceInfo = await generateWorkspaceInfo(cwd);
	const workspaceConfig = {
		workspaces: {
			[workspaceInfo.rootPath]: {
				hint: workspaceInfo.hint,
				associatedRemoteUrls: workspaceInfo.associatedRemoteUrls,
				latestGitCommitHash: workspaceInfo.latestGitCommitHash,
				latestGitBranchName: workspaceInfo.latestGitBranchName,
			},
		},
	};
	return `# Workspace Configuration\n${JSON.stringify(workspaceConfig, null, 2)}`;
}
