import { displayName, version } from "../../package.json";

export function getCliBuildInfo(): { name: string; version: string } {
	return {
		name: displayName,
		version,
	};
}
