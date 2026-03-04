import { nanoid } from "nanoid";

export function createTeamName(): string {
	return `team-${nanoid(5)}`;
}
