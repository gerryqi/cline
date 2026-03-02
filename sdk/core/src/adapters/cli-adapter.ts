// Intentionally thin in the first iteration.
// CLI continues to call core services directly while this adapter surface stabilizes.
export interface CliAdapterOptions {
	cwd: string;
}
