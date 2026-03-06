"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

// Package Dependency Graph - Interactive visual
export function PackageDependencyGraph() {
	const [hoveredPackage, setHoveredPackage] = useState<string | null>(null);

	const packages: Record<
		string,
		{ label: string; description: string; kind: "sdk" | "app" }
	> = {
		shared: {
			label: "@cline/shared",
			description: "Leaf — contracts, schemas, utilities",
			kind: "sdk",
		},
		llms: {
			label: "@cline/llms",
			description: "Depends on shared",
			kind: "sdk",
		},
		agents: {
			label: "@cline/agents",
			description: "Depends on llms, shared",
			kind: "sdk",
		},
		rpc: {
			label: "@cline/rpc",
			description: "Leaf — gRPC gateway, no internal deps",
			kind: "sdk",
		},
		core: {
			label: "@cline/core",
			description: "Depends on agents, llms, rpc, shared",
			kind: "sdk",
		},
		cli: {
			label: "@cline/cli",
			description: "App shell — depends on core, rpc, agents, llms, shared",
			kind: "app",
		},
		code: {
			label: "@cline/code",
			description: "App shell — depends on core, rpc, agents, llms, shared",
			kind: "app",
		},
		desktop: {
			label: "@cline/desktop",
			description: "App shell — depends on core, agents, llms",
			kind: "app",
		},
	};

	const connections = [
		{ from: "shared", to: "llms" },
		{ from: "shared", to: "agents" },
		{ from: "llms", to: "agents" },
		{ from: "agents", to: "core" },
		{ from: "llms", to: "core" },
		{ from: "rpc", to: "core" },
		{ from: "shared", to: "core" },
		{ from: "core", to: "cli" },
		{ from: "core", to: "code" },
		{ from: "core", to: "desktop" },
	];

	const getPackageStyle = (id: string) => {
		const isHovered = hoveredPackage === id;
		const isConnected =
			hoveredPackage &&
			(connections.some((c) => c.from === hoveredPackage && c.to === id) ||
				connections.some((c) => c.to === hoveredPackage && c.from === id));

		if (isHovered)
			return "border-cyan-400 bg-cyan-500/20 shadow-lg shadow-cyan-500/20";
		if (isConnected) return "border-cyan-500/50 bg-cyan-500/10";
		if (hoveredPackage) return "opacity-40";
		return "border-zinc-700 bg-zinc-900/80";
	};

	const isEdgeHighlighted = (from: string, to: string) =>
		hoveredPackage === from || hoveredPackage === to;

	const PackageBox = ({ id }: { id: string }) => {
		const pkg = packages[id];
		return (
			<div
				className={cn(
					"px-5 py-2.5 rounded-lg border-2 transition-all duration-200 cursor-pointer",
					getPackageStyle(id),
				)}
				onMouseEnter={() => setHoveredPackage(id)}
				onMouseLeave={() => setHoveredPackage(null)}
			>
				<div className="text-sm font-mono font-semibold text-cyan-400">
					{pkg.label}
				</div>
				<div className="text-[10px] text-zinc-500 mt-0.5">
					{pkg.description}
				</div>
			</div>
		);
	};

	const Arrow = ({ from, to }: { from: string; to: string }) => (
		<div className="flex flex-col items-center">
			<div
				className={cn(
					"w-0.5 h-5 transition-colors",
					isEdgeHighlighted(from, to) ? "bg-cyan-400" : "bg-zinc-700",
				)}
			/>
			<div
				className={cn(
					"w-0 h-0 border-l-[5px] border-r-[5px] border-t-[7px] border-l-transparent border-r-transparent transition-colors",
					isEdgeHighlighted(from, to)
						? "border-t-cyan-400"
						: "border-t-zinc-700",
				)}
			/>
		</div>
	);

	return (
		<div className="relative py-8">
			<div className="flex flex-col items-center gap-4">
				{/* Row 0: Leaf packages — shared and rpc */}
				<div className="flex gap-12 items-start">
					<PackageBox id="shared" />
					<PackageBox id="rpc" />
				</div>

				{/* Arrows from leaves down */}
				<div className="flex gap-12 items-start">
					<Arrow from="shared" to="llms" />
					<div className="w-[120px]" />
				</div>

				{/* Row 1: llms */}
				<PackageBox id="llms" />

				{/* Arrow llms → agents */}
				<Arrow from="llms" to="agents" />

				{/* Row 2: agents */}
				<PackageBox id="agents" />

				{/* Arrow agents → core */}
				<Arrow from="agents" to="core" />

				{/* Row 3: core (also receives rpc, shared edges) */}
				<PackageBox id="core" />

				{/* Branch arrows to apps */}
				<div className="flex items-start gap-16">
					<Arrow from="core" to="cli" />
					<Arrow from="core" to="code" />
					<Arrow from="core" to="desktop" />
				</div>

				{/* Row 4: App targets */}
				<div className="flex gap-5 flex-wrap justify-center">
					<PackageBox id="cli" />
					<PackageBox id="code" />
					<PackageBox id="desktop" />
				</div>
			</div>

			{/* Legend */}
			<div className="mt-6 flex justify-center gap-6 text-[11px] text-zinc-500">
				<div className="flex items-center gap-1.5">
					<span className="w-2 h-2 rounded-full bg-cyan-500/50" />
					<span>SDK packages</span>
				</div>
				<div className="flex items-center gap-1.5">
					<span className="w-2 h-2 rounded-sm bg-zinc-600" />
					<span>App targets</span>
				</div>
				<span className="text-zinc-600">|</span>
				<span>Hover to highlight dependencies</span>
			</div>
		</div>
	);
}

// Agent Loop Flow Diagram - Interactive
export function AgentLoopDiagram({ variant }: { variant: "original" | "new" }) {
	const [activeStep, setActiveStep] = useState<number | null>(null);

	if (variant === "original") {
		const steps = [
			{ label: "startTask()", desc: "Entry point" },
			{
				label: "initiateTaskLoop()",
				desc: "OUTER while-loop",
				highlight: true,
			},
			{
				label: "recursivelyMakeClineRequests()",
				desc: "INNER recursive fn",
				highlight: true,
			},
			{ label: "Build prompt + context", desc: "System prompt assembly" },
			{ label: "Call LLM API", desc: "Streaming response" },
			{ label: "Parse streaming chunks", desc: "XML parsing" },
			{ label: "presentAssistantMessage()", desc: "Handle text/tool_use" },
			{ label: "say() / executeTool()", desc: "UI or execute" },
			{ label: "Recurse with results", desc: "Loop continues" },
		];

		return (
			<div className="space-y-2">
				{steps.map((step, i) => (
					<div
						key={i}
						className={cn(
							"flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer",
							activeStep === i
								? "border-amber-500/50 bg-amber-500/10"
								: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700",
							step.highlight && "ml-4",
						)}
						onMouseEnter={() => setActiveStep(i)}
						onMouseLeave={() => setActiveStep(null)}
					>
						<div
							className={cn(
								"w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
								activeStep === i
									? "bg-amber-500 text-zinc-900"
									: "bg-zinc-800 text-zinc-400",
							)}
						>
							{i + 1}
						</div>
						<div className="flex-1 min-w-0">
							<div className="text-xs font-mono text-zinc-200 truncate">
								{step.label}
							</div>
							<div className="text-[10px] text-zinc-500">{step.desc}</div>
						</div>
						{step.highlight && (
							<span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 uppercase font-semibold">
								Loop
							</span>
						)}
					</div>
				))}
			</div>
		);
	}

	// New SDK flow
	const steps = [
		{ label: "run() / continue()", desc: "Entry point" },
		{ label: "Initialize extensions", desc: "One-time setup" },
		{ label: "Run onSessionStart hooks", desc: "Hook system" },
		{ label: "executeLoop()", desc: "SINGLE while-loop", highlight: true },
		{ label: "processTurn()", desc: "One API call + execution" },
		{ label: "Call handler.createMessage()", desc: "Streaming response" },
		{ label: "Accumulate response", desc: "text + tool_use blocks" },
		{ label: "Validate + check policies", desc: "Tool validation" },
		{ label: "Execute tools", desc: "Parallel or sequential" },
		{ label: "Return { continue }", desc: "Loop decision" },
	];

	return (
		<div className="space-y-2">
			{steps.map((step, i) => (
				<div
					key={i}
					className={cn(
						"flex items-center gap-3 p-2.5 rounded-lg border transition-all cursor-pointer",
						activeStep === i
							? "border-emerald-500/50 bg-emerald-500/10"
							: "border-zinc-800 bg-zinc-900/50 hover:border-zinc-700",
						i >= 4 && i <= 9 && "ml-4",
					)}
					onMouseEnter={() => setActiveStep(i)}
					onMouseLeave={() => setActiveStep(null)}
				>
					<div
						className={cn(
							"w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold shrink-0",
							activeStep === i
								? "bg-emerald-500 text-zinc-900"
								: "bg-zinc-800 text-zinc-400",
						)}
					>
						{i + 1}
					</div>
					<div className="flex-1 min-w-0">
						<div className="text-xs font-mono text-zinc-200 truncate">
							{step.label}
						</div>
						<div className="text-[10px] text-zinc-500">{step.desc}</div>
					</div>
					{step.highlight && (
						<span className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase font-semibold">
							Loop
						</span>
					)}
				</div>
			))}
		</div>
	);
}

// Streaming Model Diagram
export function StreamingModelDiagram({
	variant,
}: {
	variant: "interleaved" | "sequential";
}) {
	const [animating, setAnimating] = useState(false);
	const [currentStep, setCurrentStep] = useState(0);

	const startAnimation = () => {
		setAnimating(true);
		setCurrentStep(0);
		const totalSteps = variant === "interleaved" ? 7 : 8;

		const interval = setInterval(() => {
			setCurrentStep((prev) => {
				if (prev >= totalSteps - 1) {
					clearInterval(interval);
					setAnimating(false);
					return prev;
				}
				return prev + 1;
			});
		}, 800);
	};

	if (variant === "interleaved") {
		const steps = [
			{ type: "stream", label: 'Stream: "<read_file>..."' },
			{ type: "block", label: "BLOCK: ask approval" },
			{ type: "execute", label: "Execute: read_file" },
			{ type: "stream", label: 'Stream: "</read_file>"' },
			{ type: "stream", label: 'Stream: "<execute_command>..."' },
			{ type: "block", label: "BLOCK: ask approval" },
			{ type: "execute", label: "Execute WHILE streaming" },
		];

		return (
			<div className="space-y-3">
				<div className="flex justify-between items-center mb-3">
					<span className="text-[11px] text-zinc-500 uppercase tracking-wider">
						Interleaved Stream + Execute
					</span>
					<Button
						onClick={startAnimation}
						disabled={animating}
						className="text-[10px] px-2 py-1 rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30 disabled:opacity-50 transition-colors"
					>
						{animating ? "Running..." : "Animate"}
					</Button>
				</div>
				<div className="space-y-1.5">
					{steps.map((step, i) => (
						<div
							key={i}
							className={cn(
								"flex items-center gap-2 p-2 rounded text-[11px] transition-all duration-300",
								animating && currentStep >= i
									? "opacity-100"
									: animating
										? "opacity-20"
										: "opacity-100",
								step.type === "stream" && "bg-zinc-800/50 text-zinc-300",
								step.type === "block" &&
									"bg-red-500/10 text-red-400 border border-red-500/30",
								step.type === "execute" && "bg-amber-500/10 text-amber-400",
							)}
						>
							<span
								className={cn(
									"w-1.5 h-1.5 rounded-full shrink-0",
									step.type === "stream" && "bg-zinc-500",
									step.type === "block" && "bg-red-500",
									step.type === "execute" && "bg-amber-500",
								)}
							/>
							<span className="font-mono">{step.label}</span>
						</div>
					))}
				</div>
			</div>
		);
	}

	// Sequential
	const steps = [
		{ type: "stream", label: "Stream: text content" },
		{ type: "stream", label: "Stream: tool_use (read_files)" },
		{ type: "stream", label: "Stream: tool_use (run_commands)" },
		{ type: "complete", label: "Stream completes" },
		{ type: "divider", label: "THEN" },
		{ type: "execute", label: "Execute: read_files → result" },
		{ type: "execute", label: "Execute: run_commands → result" },
		{ type: "next", label: "Append results → next iteration" },
	];

	return (
		<div className="space-y-3">
			<div className="flex justify-between items-center mb-3">
				<span className="text-[11px] text-zinc-500 uppercase tracking-wider">
					Complete Stream → Execute All
				</span>
				<Button
					onClick={startAnimation}
					disabled={animating}
					className="text-[10px] px-2 py-1 rounded bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 disabled:opacity-50 transition-colors"
				>
					{animating ? "Running..." : "Animate"}
				</Button>
			</div>
			<div className="space-y-1.5">
				{steps.map((step, i) => (
					<div
						key={i}
						className={cn(
							"flex items-center gap-2 p-2 rounded text-[11px] transition-all duration-300",
							animating && currentStep >= i
								? "opacity-100"
								: animating
									? "opacity-20"
									: "opacity-100",
							step.type === "stream" && "bg-zinc-800/50 text-zinc-300",
							step.type === "complete" &&
								"bg-cyan-500/10 text-cyan-400 border border-cyan-500/30",
							step.type === "divider" &&
								"bg-zinc-900 text-zinc-600 justify-center font-bold",
							step.type === "execute" && "bg-emerald-500/10 text-emerald-400",
							step.type === "next" && "bg-cyan-500/10 text-cyan-400",
						)}
					>
						{step.type !== "divider" && (
							<span
								className={cn(
									"w-1.5 h-1.5 rounded-full shrink-0",
									step.type === "stream" && "bg-zinc-500",
									step.type === "complete" && "bg-cyan-500",
									step.type === "execute" && "bg-emerald-500",
									step.type === "next" && "bg-cyan-500",
								)}
							/>
						)}
						<span className="font-mono">{step.label}</span>
					</div>
				))}
			</div>
		</div>
	);
}

// Session Storage Diagram
export function SessionStorageDiagram({
	variant,
}: {
	variant: "original" | "new";
}) {
	const [expanded, setExpanded] = useState<string | null>(null);

	if (variant === "original") {
		const items = [
			{
				id: "vscode",
				label: "VS Code Extension",
				children: [
					{
						id: "task",
						label: "Task (owns everything)",
						children: [
							{
								id: "msg",
								label: "MessageStateHandler → disk (JSON)",
								icon: "file",
							},
							{
								id: "state",
								label: "TaskState → memory only",
								icon: "memory",
								note: "lost on restart",
							},
							{
								id: "global",
								label: "globalState → VS Code storage",
								icon: "db",
							},
						],
					},
				],
			},
		];

		return (
			<div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
				<FolderTree
					items={items}
					expanded={expanded}
					setExpanded={setExpanded}
					variant="original"
				/>
			</div>
		);
	}

	const items = [
		{
			id: "session",
			label: "SessionService (platform-agnostic)",
			children: [
				{
					id: "store",
					label: "SessionStore (SQLite)",
					icon: "db",
					desc: "session records",
				},
				{
					id: "artifact",
					label: "ArtifactStore (files)",
					icon: "file",
					desc: "transcripts, messages",
				},
				{
					id: "graph",
					label: "SessionGraph",
					icon: "graph",
					desc: "ID hierarchy",
				},
				{
					id: "workspace",
					label: "WorkspaceManager",
					icon: "folder",
					desc: "workspace roots",
				},
			],
		},
		{
			id: "adapter",
			label: "Consumed via Host Runtime Entry Points",
			children: [
				{
					id: "cli",
					label: "CLI Session Manager (createDefaultCliSessionManager)",
					icon: "terminal",
				},
				{
					id: "code",
					label: "Code App Runtime Bridge (scripts/chat-runtime-bridge.ts)",
					icon: "desktop",
				},
				{
					id: "desktop",
					label: "Desktop Runtime Bridge (scripts/chat-runtime-bridge.ts)",
					icon: "desktop",
				},
			],
		},
	];

	return (
		<div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
			<FolderTree
				items={items}
				expanded={expanded}
				setExpanded={setExpanded}
				variant="new"
			/>
		</div>
	);
}

interface TreeItem {
	id: string;
	label: string;
	icon?: string;
	desc?: string;
	note?: string;
	children?: TreeItem[];
}

function FolderTree({
	items,
	expanded,
	setExpanded,
	variant,
	depth = 0,
}: {
	items: TreeItem[];
	expanded: string | null;
	setExpanded: (id: string | null) => void;
	variant: "original" | "new";
	depth?: number;
}) {
	const color = variant === "original" ? "amber" : "emerald";

	return (
		<div
			className={cn(
				"space-y-1",
				depth > 0 && "ml-4 border-l border-zinc-800 pl-3",
			)}
		>
			{items.map((item) => (
				<div key={item.id}>
					<div
						className={cn(
							"flex items-center gap-2 p-2 rounded cursor-pointer transition-colors",
							expanded === item.id
								? `bg-${color}-500/10 border border-${color}-500/30`
								: "hover:bg-zinc-800/50",
						)}
						onClick={() => setExpanded(expanded === item.id ? null : item.id)}
					>
						{item.children ? (
							<svg
								className={cn(
									"w-3 h-3 transition-transform",
									expanded === item.id && "rotate-90",
								)}
								fill="none"
								viewBox="0 0 24 24"
								stroke="currentColor"
							>
								<path
									strokeLinecap="round"
									strokeLinejoin="round"
									strokeWidth={2}
									d="M9 5l7 7-7 7"
								/>
							</svg>
						) : (
							<span
								className={cn(
									"w-2 h-2 rounded-full",
									item.icon === "file" && "bg-blue-400",
									item.icon === "memory" && "bg-yellow-400",
									item.icon === "db" && "bg-purple-400",
									item.icon === "graph" && "bg-cyan-400",
									item.icon === "folder" && "bg-orange-400",
									item.icon === "terminal" && "bg-green-400",
									item.icon === "desktop" && "bg-pink-400",
									!item.icon && "bg-zinc-500",
								)}
							/>
						)}
						<span className="text-xs font-mono text-zinc-200">
							{item.label}
						</span>
						{item.desc && (
							<span className="text-[10px] text-zinc-500">— {item.desc}</span>
						)}
						{item.note && (
							<span className="text-[9px] px-1.5 py-0.5 rounded bg-yellow-500/20 text-yellow-400 ml-auto">
								{item.note}
							</span>
						)}
					</div>
					{item.children && (expanded === item.id || depth === 0) && (
						<FolderTree
							items={item.children}
							expanded={expanded}
							setExpanded={setExpanded}
							variant={variant}
							depth={depth + 1}
						/>
					)}
				</div>
			))}
		</div>
	);
}

// Multi-Agent Diagram
export function MultiAgentDiagram({
	variant,
}: {
	variant: "original" | "new";
}) {
	const [activeNode, setActiveNode] = useState<string | null>(null);

	if (variant === "original") {
		return (
			<div className="p-6">
				<div className="flex flex-col items-center gap-4">
					{/* Parent Task */}
					<div
						className={cn(
							"px-6 py-3 rounded-lg border-2 transition-all cursor-pointer",
							activeNode === "parent"
								? "border-amber-400 bg-amber-500/20"
								: "border-zinc-700 bg-zinc-900/80",
						)}
						onMouseEnter={() => setActiveNode("parent")}
						onMouseLeave={() => setActiveNode(null)}
					>
						<div className="text-sm font-semibold text-amber-400">
							Parent Task
						</div>
					</div>

					{/* Arrow down */}
					<div className="flex flex-col items-center">
						<div className="w-0.5 h-4 bg-zinc-700" />
						<div className="text-[10px] text-zinc-500 px-2 py-1 bg-zinc-900 rounded border border-zinc-800">
							use_subagents
						</div>
						<div className="w-0.5 h-4 bg-zinc-700" />
					</div>

					{/* Children */}
					<div className="flex gap-3">
						{[1, 2, 3].map((i) => (
							<div
								key={i}
								className={cn(
									"px-4 py-2 rounded-lg border transition-all cursor-pointer",
									activeNode === `child-${i}`
										? "border-zinc-500 bg-zinc-800"
										: "border-zinc-800 bg-zinc-900/50",
								)}
								onMouseEnter={() => setActiveNode(`child-${i}`)}
								onMouseLeave={() => setActiveNode(null)}
							>
								<div className="text-xs text-zinc-400">Child {i}</div>
							</div>
						))}
					</div>

					<div className="text-[10px] text-zinc-500 bg-zinc-900 px-2 py-1 rounded border border-zinc-800">
						all parallel, max 5
					</div>

					{/* Results back */}
					<div className="flex items-center gap-2 text-[10px] text-zinc-500">
						<span>←</span>
						<span className="px-2 py-0.5 rounded bg-zinc-800">
							text results
						</span>
						<span>←</span>
						<span className="text-red-400">(children gone)</span>
					</div>
				</div>
			</div>
		);
	}

	// New team architecture
	return (
		<div className="p-6">
			<div className="flex flex-col items-center gap-4">
				{/* Lead Agent */}
				<div className="flex items-center gap-3">
					<div
						className={cn(
							"px-6 py-3 rounded-lg border-2 transition-all cursor-pointer",
							activeNode === "lead"
								? "border-emerald-400 bg-emerald-500/20"
								: "border-zinc-700 bg-zinc-900/80",
						)}
						onMouseEnter={() => setActiveNode("lead")}
						onMouseLeave={() => setActiveNode(null)}
					>
						<div className="text-sm font-semibold text-emerald-400">
							Lead Agent
						</div>
					</div>
					<div className="text-[10px] px-2 py-1 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
						routing tools
					</div>
				</div>

				{/* Branches */}
				<div className="flex gap-12">
					{/* Coder branch */}
					<div className="flex flex-col items-center gap-2">
						<div className="flex flex-col items-center">
							<div className="w-0.5 h-4 bg-zinc-700" />
							<div className="text-[10px] text-zinc-500 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800">
								delegate_to
							</div>
							<div className="w-0.5 h-4 bg-zinc-700" />
						</div>
						<div
							className={cn(
								"px-4 py-2 rounded-lg border transition-all cursor-pointer",
								activeNode === "coder"
									? "border-cyan-500 bg-cyan-500/10"
									: "border-zinc-800 bg-zinc-900/50",
							)}
							onMouseEnter={() => setActiveNode("coder")}
							onMouseLeave={() => setActiveNode(null)}
						>
							<div className="text-xs font-semibold text-cyan-400">
								Coder Agent
							</div>
							<div className="text-[10px] text-zinc-500">(full loop)</div>
						</div>
						<div className="text-[10px] text-emerald-400">↑ reports back</div>
					</div>

					{/* Reviewer branch */}
					<div className="flex flex-col items-center gap-2">
						<div className="flex flex-col items-center">
							<div className="w-0.5 h-4 bg-zinc-700" />
							<div className="text-[10px] text-zinc-500 px-2 py-0.5 bg-zinc-900 rounded border border-zinc-800">
								delegate_to
							</div>
							<div className="w-0.5 h-4 bg-zinc-700" />
						</div>
						<div
							className={cn(
								"px-4 py-2 rounded-lg border transition-all cursor-pointer",
								activeNode === "reviewer"
									? "border-purple-500 bg-purple-500/10"
									: "border-zinc-800 bg-zinc-900/50",
							)}
							onMouseEnter={() => setActiveNode("reviewer")}
							onMouseLeave={() => setActiveNode(null)}
						>
							<div className="text-xs font-semibold text-purple-400">
								Reviewer Agent
							</div>
							<div className="text-[10px] text-zinc-500">(full loop)</div>
						</div>
						<div className="text-[10px] text-emerald-400">↑ reports back</div>
					</div>
				</div>

				{/* Decision */}
				<div className="text-[10px] text-zinc-400 bg-zinc-900 px-3 py-1.5 rounded border border-zinc-800 mt-2">
					Lead decides what to do next{" "}
					<span className="text-emerald-400">
						(team persists across interactions)
					</span>
				</div>
			</div>
		</div>
	);
}

// Runtime Adapter Diagram
export function RuntimeAdapterDiagram() {
	const [activeLayer, setActiveLayer] = useState<string | null>(null);

	const layers = [
		{
			id: "builder",
			label: "DefaultRuntimeBuilder",
			desc: "assembles tools + hooks + teams from config",
			color: "cyan",
		},
		{
			id: "built",
			label: "BuiltRuntime",
			desc: "tools + hooks + logger + teamRuntime + shutdown",
			color: "emerald",
		},
		{
			id: "manager",
			label: "DefaultSessionManager",
			desc: "start / send / abort / stop / list / subscribe",
			color: "purple",
		},
	];

	const apps = [
		{ id: "cli", label: "@cline/cli", color: "amber" },
		{ id: "code", label: "@cline/code", color: "pink" },
		{ id: "desktop", label: "@cline/desktop", color: "orange" },
	];

	const sidecar = {
		id: "rpc",
		label: "@cline/rpc",
		desc: "gRPC gateway (optional)",
		color: "sky",
	};

	return (
		<div className="py-6">
			<div className="flex flex-col items-center gap-4">
				{/* Stacked layers */}
				{layers.map((layer, i) => (
					<div key={layer.id}>
						<div
							className={cn(
								"px-8 py-3 rounded-lg border-2 transition-all cursor-pointer text-center min-w-[320px]",
								activeLayer === layer.id
									? `border-${layer.color}-400 bg-${layer.color}-500/20 shadow-lg shadow-${layer.color}-500/20`
									: "border-zinc-700 bg-zinc-900/80 hover:border-zinc-600",
							)}
							onMouseEnter={() => setActiveLayer(layer.id)}
							onMouseLeave={() => setActiveLayer(null)}
						>
							<div
								className={cn(
									"text-sm font-semibold",
									`text-${layer.color}-400`,
								)}
							>
								{layer.label}
							</div>
							<div className="text-[10px] text-zinc-500 mt-0.5">
								{layer.desc}
							</div>
						</div>
						{i < layers.length - 1 && (
							<div className="flex justify-center">
								<div className="w-0.5 h-6 bg-zinc-700" />
							</div>
						)}
					</div>
				))}

				{/* Branch arrows to apps */}
				<div className="flex items-center gap-16">
					<div className="w-0.5 h-6 bg-zinc-700" />
					<div className="w-0.5 h-6 bg-zinc-700" />
					<div className="w-0.5 h-6 bg-zinc-700" />
				</div>

				{/* App targets + optional RPC sidecar */}
				<div className="flex gap-4 flex-wrap justify-center">
					{apps.map((app) => (
						<div
							key={app.id}
							className={cn(
								"px-5 py-2.5 rounded-lg border-2 transition-all cursor-pointer",
								activeLayer === app.id
									? `border-${app.color}-400 bg-${app.color}-500/20`
									: "border-zinc-700 bg-zinc-900/80 hover:border-zinc-600",
							)}
							onMouseEnter={() => setActiveLayer(app.id)}
							onMouseLeave={() => setActiveLayer(null)}
						>
							<div
								className={cn("text-sm font-semibold", `text-${app.color}-400`)}
							>
								{app.label}
							</div>
						</div>
					))}
					<div
						className={cn(
							"px-5 py-2.5 rounded-lg border-2 border-dashed transition-all cursor-pointer",
							activeLayer === sidecar.id
								? `border-${sidecar.color}-400 bg-${sidecar.color}-500/20`
								: "border-zinc-700 bg-zinc-900/80 hover:border-zinc-600",
						)}
						onMouseEnter={() => setActiveLayer(sidecar.id)}
						onMouseLeave={() => setActiveLayer(null)}
					>
						<div
							className={cn(
								"text-sm font-semibold",
								`text-${sidecar.color}-400`,
							)}
						>
							{sidecar.label}
						</div>
						<div className="text-[10px] text-zinc-500 mt-0.5">
							{sidecar.desc}
						</div>
					</div>
				</div>

				{/* Note */}
				<div className="mt-4 text-[11px] text-zinc-500 text-center max-w-md">
					The same Agent instance works identically in all environments. Apps
					compose DefaultSessionManager with platform-specific hooks, approval
					callbacks, and event delivery.
				</div>
			</div>
		</div>
	);
}

// Session Graph Visual
export function SessionGraphVisual() {
	const [hoveredId, setHoveredId] = useState<string | null>(null);

	const sessions = [
		{ id: "root-session-abc", level: 0, label: "Root session" },
		{ id: "root-session-abc__worker-1", level: 1, label: "Sub-agent session" },
		{
			id: "root-session-abc__teamtask__worker-1__x7",
			level: 2,
			label: "Team task session",
		},
	];

	return (
		<div className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-800">
			<div className="text-[11px] text-zinc-500 uppercase tracking-wider mb-3">
				Hierarchical Session IDs
			</div>
			<div className="space-y-2">
				{sessions.map((session, _i) => (
					<div
						key={session.id}
						className={cn(
							"flex items-center gap-3 transition-all cursor-pointer",
							hoveredId === session.id && "scale-[1.02]",
						)}
						style={{ paddingLeft: `${session.level * 20}px` }}
						onMouseEnter={() => setHoveredId(session.id)}
						onMouseLeave={() => setHoveredId(null)}
					>
						{session.level > 0 && <span className="text-zinc-600">└─</span>}
						<div
							className={cn(
								"flex-1 px-3 py-2 rounded border font-mono text-xs transition-colors",
								hoveredId === session.id
									? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
									: "border-zinc-800 bg-zinc-900/80 text-zinc-400",
							)}
						>
							<span className="text-zinc-600">
								{session.id.split("__").slice(0, -1).join("__")}
							</span>
							{session.id.includes("__") && (
								<span className="text-zinc-600">__</span>
							)}
							<span
								className={cn(
									hoveredId === session.id ? "text-cyan-400" : "text-zinc-200",
								)}
							>
								{session.id.split("__").pop()}
							</span>
							<span className="ml-3 text-[10px] text-zinc-600">
								# {session.label}
							</span>
						</div>
					</div>
				))}
			</div>
		</div>
	);
}
