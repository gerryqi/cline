"use client";

import {
	ArrowLeft,
	ChevronDown,
	Pause,
	Play,
	RotateCcw,
	SkipForward,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { scenarios, sourceAnchors } from "@/lib/lifecycle-data";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";
import { StepDetails } from "./step-details";
import { Timeline } from "./timeline";

const scenarioList = [
	{ key: "promptFlow", label: "Prompt Request Flow (CLI to Response)" },
	{ key: "session", label: "Session Lifecycle" },
	{ key: "agentRuntime", label: "Agent Runtime Modular Flow" },
	{
		key: "agentTeamLoop",
		label: "Agent Team Lifecycle (During Agent Loop)",
	},
	{ key: "hooksPlugins", label: "Hook Events + Core Runtime Flow" },
	{ key: "coreRpc", label: "Core + RPC Package" },
	{ key: "cli", label: "CLI Flow" },
	{ key: "code", label: "Code App Flow" },
	{ key: "desktop", label: "Desktop App Chat + Discovery Flow" },
] as const;

const hookStageLegend = [
	{
		label: "Run lifecycle events",
		stages: ["input", "session_start", "run_start", "turn_start", "run_end"],
		tone: "bg-cyan-500/20 text-cyan-300 border-cyan-500/30",
	},
	{
		label: "Iteration lifecycle events",
		stages: [
			"iteration_start",
			"before_agent_start",
			"turn_end",
			"iteration_end",
		],
		tone: "bg-indigo-500/20 text-indigo-300 border-indigo-500/30",
	},
	{
		label: "Tool lifecycle events",
		stages: ["tool_call_before", "tool_call_after"],
		tone: "bg-amber-500/20 text-amber-300 border-amber-500/30",
	},
	{
		label: "Async/runtime events",
		stages: ["runtime_event", "error", "session_shutdown"],
		tone: "bg-zinc-700/60 text-zinc-300 border-zinc-600",
	},
] as const;

const sessionStateLifecycle = [
	{
		state: "initialized",
		note: "Session ID + paths are reserved in memory at start().",
	},
	{
		state: "persisted",
		note: "First user prompt triggers DB row + manifest/messages artifacts.",
	},
	{
		state: "running",
		note: "Agent turn executes and stream events flow to clients.",
	},
	{
		state: "completed",
		note: "Successful turn finalizes session status.",
	},
	{
		state: "failed",
		note: "Error path finalizes status with failure.",
	},
	{
		state: "cancelled",
		note: "Abort/stop/dispose finalizes status as cancelled.",
	},
] as const;

interface LifecycleVisualizerProps {
	onBack: () => void;
}

export function LifecycleVisualizer({ onBack }: LifecycleVisualizerProps) {
	const [selectedScenario, setSelectedScenario] = useState("promptFlow");
	const [currentStep, setCurrentStep] = useState(0);
	const [isPlaying, setIsPlaying] = useState(false);
	const [dropdownOpen, setDropdownOpen] = useState(false);

	const scenario = scenarios[selectedScenario];
	const step = scenario.steps[currentStep];

	const handleScenarioChange = useCallback((key: string) => {
		setSelectedScenario(key);
		setCurrentStep(0);
		setIsPlaying(false);
		setDropdownOpen(false);
	}, []);

	const handleNext = useCallback(() => {
		setCurrentStep((prev) =>
			prev < scenario.steps.length - 1 ? prev + 1 : prev,
		);
	}, [scenario.steps.length]);

	const handlePrev = useCallback(() => {
		setCurrentStep((prev) => (prev > 0 ? prev - 1 : prev));
	}, []);

	const handleReset = useCallback(() => {
		setCurrentStep(0);
		setIsPlaying(false);
	}, []);

	const handlePlayPause = useCallback(() => {
		setIsPlaying((prev) => !prev);
	}, []);

	useEffect(() => {
		if (!isPlaying) return;

		const timer = setInterval(() => {
			setCurrentStep((prev) => {
				if (prev >= scenario.steps.length - 1) {
					setIsPlaying(false);
					return prev;
				}
				return prev + 1;
			});
		}, 2000);

		return () => clearInterval(timer);
	}, [isPlaying, scenario.steps.length]);

	// Keyboard navigation
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "ArrowRight" || e.key === "ArrowDown") {
				e.preventDefault();
				handleNext();
			} else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
				e.preventDefault();
				handlePrev();
			} else if (e.key === " ") {
				e.preventDefault();
				handlePlayPause();
			} else if (e.key === "Escape") {
				setDropdownOpen(false);
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [handleNext, handlePrev, handlePlayPause]);

	// Close dropdown on outside click
	useEffect(() => {
		const handleClick = (e: MouseEvent) => {
			if (
				dropdownOpen &&
				!(e.target as Element).closest(".scenario-dropdown")
			) {
				setDropdownOpen(false);
			}
		};
		document.addEventListener("click", handleClick);
		return () => document.removeEventListener("click", handleClick);
	}, [dropdownOpen]);

	const selectedLabel =
		scenarioList.find((s) => s.key === selectedScenario)?.label || "";

	return (
		<div className="flex h-screen bg-zinc-950 text-zinc-100">
			{/* Left Sidebar - Scenarios & Timeline */}
			<aside className="w-72 border-r border-zinc-800 flex flex-col">
				{/* Header with Back Button */}
				<div className="p-4 border-b border-zinc-800">
					<Button
						onClick={onBack}
						className="flex items-center gap-1.5 text-xs text-zinc-500 hover:text-cyan-400 transition-colors mb-3"
					>
						<ArrowLeft className="w-3.5 h-3.5" />
						Back to Overview
					</Button>
					<h1 className="text-base font-semibold text-zinc-100">
						Cline SDK Lifecycle
					</h1>
					<p className="text-xs text-zinc-500 mt-1">
						Interactive flow visualizer
					</p>
				</div>

				{/* Scenario Dropdown */}
				<div className="p-3 border-b border-zinc-800">
					<div className="relative scenario-dropdown">
						<Button
							onClick={() => setDropdownOpen(!dropdownOpen)}
							className="w-full flex items-center justify-between px-3 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-sm text-zinc-100 hover:border-zinc-700 transition-colors"
						>
							<span className="truncate pr-2">{selectedLabel}</span>
							<ChevronDown
								className={cn(
									"w-4 h-4 text-zinc-500 shrink-0 transition-transform",
									dropdownOpen && "rotate-180",
								)}
							/>
						</Button>

						{dropdownOpen && (
							<div className="absolute top-full left-0 right-0 mt-1 bg-zinc-900 border border-zinc-800 rounded-lg shadow-xl z-50 overflow-hidden">
								{scenarioList.map(({ key, label }) => (
									<Button
										key={key}
										onClick={() => handleScenarioChange(key)}
										className={cn(
											"w-full px-3 py-2 text-left text-sm transition-colors",
											selectedScenario === key
												? "bg-cyan-500/20 text-cyan-400"
												: "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
										)}
									>
										{label}
									</Button>
								))}
							</div>
						)}
					</div>
				</div>

				{/* Timeline */}
				<div className="flex-1 overflow-y-auto p-3">
					<Timeline
						steps={scenario.steps}
						currentStep={currentStep}
						onStepClick={setCurrentStep}
					/>
				</div>

				{/* Controls */}
				<div className="p-3 border-t border-zinc-800">
					<div className="flex items-center gap-1.5">
						<Button
							onClick={handlePlayPause}
							className={cn(
								"flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-md text-xs font-medium transition-colors",
								isPlaying
									? "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
									: "bg-cyan-500/20 text-cyan-400 hover:bg-cyan-500/30",
							)}
						>
							{isPlaying ? (
								<>
									<Pause className="w-3.5 h-3.5" />
									Pause
								</>
							) : (
								<>
									<Play className="w-3.5 h-3.5" />
									Play
								</>
							)}
						</Button>
						<Button
							onClick={handleNext}
							disabled={currentStep >= scenario.steps.length - 1}
							className="p-2 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
						>
							<SkipForward className="w-4 h-4" />
						</Button>
						<Button
							onClick={handleReset}
							className="p-2 rounded-md text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
						>
							<RotateCcw className="w-4 h-4" />
						</Button>
					</div>
					<p className="text-[10px] text-zinc-600 mt-2 text-center">
						Use arrow keys or space to navigate
					</p>
				</div>
			</aside>

			{/* Main Content */}
			<main className="flex-1 flex flex-col overflow-hidden">
				{/* Scenario Title Bar */}
				<header className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50">
					<h2 className="text-lg font-semibold text-zinc-100">
						{scenario.title}
					</h2>
					<p className="text-xs text-zinc-500 mt-0.5">
						{scenario.steps.length} steps in this flow
					</p>
				</header>

				{/* Step Details */}
				<div className="flex-1 overflow-y-auto p-6">
					<StepDetails
						stepNumber={currentStep + 1}
						totalSteps={scenario.steps.length}
						step={step}
					/>
				</div>

				{/* Footer - Source Anchors */}
				<footer className="px-6 py-3 border-t border-zinc-800 bg-zinc-900/30">
					<div className="flex items-center gap-2 overflow-x-auto">
						<span className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider shrink-0">
							Sources
						</span>
						{sourceAnchors.map((anchor, i) => (
							<code
								key={i}
								className="shrink-0 rounded bg-zinc-800/50 px-2 py-0.5 text-[10px] font-mono text-zinc-500"
							>
								{anchor}
							</code>
						))}
					</div>
				</footer>
			</main>

			{/* Right Panel - Legend */}
			<aside className="w-48 border-l border-zinc-800 p-4 flex flex-col gap-6">
				<div>
					<h3 className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-3">
						Transport Legend
					</h3>
					<div className="space-y-2">
						<div className="flex items-center gap-2">
							<span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
							<span className="text-xs text-zinc-400">gRPC / RPC</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="w-2.5 h-2.5 rounded-full bg-amber-500" />
							<span className="text-xs text-zinc-400">WebSocket</span>
						</div>
						<div className="flex items-center gap-2">
							<span className="w-2.5 h-2.5 rounded-full bg-zinc-500" />
							<span className="text-xs text-zinc-400">Local / In-process</span>
						</div>
					</div>
				</div>

				<div>
					<h3 className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-3">
						Hook Stage Legend
					</h3>
					<div className="space-y-3">
						{hookStageLegend.map((group) => (
							<div key={group.label} className="space-y-1.5">
								<div className="text-[10px] text-zinc-500">{group.label}</div>
								<div className="flex flex-wrap gap-1">
									{group.stages.map((stage) => (
										<span
											key={stage}
											className={cn(
												"rounded border px-1.5 py-0.5 text-[9px] font-mono",
												group.tone,
											)}
										>
											{stage}
										</span>
									))}
								</div>
							</div>
						))}
					</div>
				</div>

				<div>
					<h3 className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-3">
						Progress
					</h3>
					<div className="space-y-2">
						<div className="flex items-center justify-between text-xs">
							<span className="text-zinc-500">Current</span>
							<span className="text-zinc-300 font-medium">
								{currentStep + 1} / {scenario.steps.length}
							</span>
						</div>
						<div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
							<div
								className="h-full bg-cyan-500 transition-all duration-300"
								style={{
									width: `${((currentStep + 1) / scenario.steps.length) * 100}%`,
								}}
							/>
						</div>
					</div>
				</div>

				{selectedScenario === "session" && (
					<div>
						<h3 className="text-[10px] font-medium text-zinc-600 uppercase tracking-wider mb-3">
							Session States
						</h3>
						<div className="space-y-1.5">
							{sessionStateLifecycle.map((item) => (
								<div
									key={item.state}
									className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-1.5"
								>
									<div className="text-[10px] font-mono text-cyan-300">
										{item.state}
									</div>
									<div className="text-[10px] text-zinc-500 mt-0.5 leading-snug">
										{item.note}
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				<div className="flex-1" />

				<div className="text-[10px] text-zinc-600 leading-relaxed">
					Agents emit lifecycle events; core decides how to execute hook files
					per environment (Node interpreter/subprocess or host-managed
					adapters).
				</div>
			</aside>
		</div>
	);
}
