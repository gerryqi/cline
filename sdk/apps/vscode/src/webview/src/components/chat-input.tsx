import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	NativeSelect,
	NativeSelectOption,
} from "@/components/ui/native-select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function ChatInputBar({
	providers,
	models,
	provider,
	model,
	workspaceRoot,
	systemPrompt,
	enableTools,
	enableSpawn,
	enableTeams,
	autoApproveTools,
	sending,
	status,
	onProviderChange,
	onModelChange,
	onSystemPromptChange,
	onEnableToolsChange,
	onEnableSpawnChange,
	onEnableTeamsChange,
	onAutoApproveToolsChange,
	onSend,
	onAbort,
}: {
	providers: Array<{
		id: string;
		name: string;
		enabled: boolean;
		defaultModelId?: string;
	}>;
	models: Array<{ id: string; name?: string }>;
	provider: string;
	model: string;
	workspaceRoot: string;
	systemPrompt: string;
	maxIterations: string;
	enableTools: boolean;
	enableSpawn: boolean;
	enableTeams: boolean;
	autoApproveTools: boolean;
	sending: boolean;
	status: string;
	onProviderChange: (provider: string) => void;
	onModelChange: (model: string) => void;
	onSystemPromptChange: (value: string) => void;
	onMaxIterationsChange: (value: string) => void;
	onEnableToolsChange: (value: boolean) => void;
	onEnableSpawnChange: (value: boolean) => void;
	onEnableTeamsChange: (value: boolean) => void;
	onAutoApproveToolsChange: (value: boolean) => void;
	onSend: (prompt: string) => void;
	onAbort: () => void;
}) {
	const [inputValue, setInputValue] = useState("");

	const submit = () => {
		const prompt = inputValue.trim();
		if (!prompt || sending) {
			return;
		}
		setInputValue("");
		onSend(prompt);
	};

	return (
		<Card className="composer overflow-hidden">
			<CardContent className="composer__prompt">
				<Textarea
					className="min-h-42 resize-y"
					disabled={status?.includes("Failed")}
					value={inputValue}
					onChange={(event) => setInputValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key === "Enter" && !event.shiftKey) {
							event.preventDefault();
							submit();
						}
					}}
					placeholder="Enter your prompt here..."
				/>
				<div className="composer__actions">
					<div className="grid gap-2">
						<NativeSelect
							id="provider-select"
							className=""
							value={provider}
							onChange={(event) => onProviderChange(event.target.value)}
						>
							{providers.length === 0 ? (
								<NativeSelectOption value="">
									No providers available
								</NativeSelectOption>
							) : (
								providers.map((item) => (
									<NativeSelectOption key={item.id} value={item.id}>
										{item.name} ({item.id})
									</NativeSelectOption>
								))
							)}
						</NativeSelect>
					</div>
					<div className="grid gap-2">
						<NativeSelect
							id="model-select"
							value={model}
							onChange={(event) => onModelChange(event.target.value)}
						>
							{models.length === 0 ? (
								<NativeSelectOption value="">
									No models available
								</NativeSelectOption>
							) : (
								models.map((item) => (
									<NativeSelectOption key={item.id} value={item.id}>
										{item.name || item.id}
									</NativeSelectOption>
								))
							)}
						</NativeSelect>
					</div>
					<div className="composer__buttons">
						<Button
							variant={sending ? "destructive" : "default"}
							disabled={status?.includes("Failed")}
							onClick={sending ? onAbort : submit}
						>
							{sending ? "Abort" : "Send"}
						</Button>
					</div>
				</div>
				<div className="flex gap-2">
					<Label className="text-sm">Workspace</Label>
					<Input
						id="workspace-input"
						value={workspaceRoot}
						readOnly
						disabled={true}
					/>
				</div>
				<div className="hidden">
					<Label htmlFor="system-prompt">System Prompt</Label>
					<Textarea
						id="system-prompt"
						className="min-h-26 resize-y"
						value={systemPrompt}
						onChange={(event) => onSystemPromptChange(event.target.value)}
						placeholder="Optional"
					/>
					<div className="flex flex-col justify-between sm:flex-row sm:items-center gap-2">
						<Toggle
							label="Tools"
							checked={enableTools}
							onChange={onEnableToolsChange}
						/>
						<Toggle
							label="Spawn"
							checked={enableSpawn}
							onChange={onEnableSpawnChange}
						/>
						<Toggle
							label="Teams"
							checked={enableTeams}
							onChange={onEnableTeamsChange}
						/>
						<Toggle
							label="Auto-approve"
							checked={autoApproveTools}
							onChange={onAutoApproveToolsChange}
						/>
					</div>
				</div>
			</CardContent>
		</Card>
	);
}

function Toggle({
	label,
	checked,
	onChange,
}: {
	label: string;
	checked: boolean;
	onChange: (value: boolean) => void;
}) {
	return (
		<div className="toggle flex items-center gap-2.5">
			<Switch checked={checked} onCheckedChange={(value) => onChange(value)} />
			<Label className="text-xs">{label}</Label>
		</div>
	);
}
