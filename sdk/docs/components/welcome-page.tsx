"use client";

import { ArrowRight, Play } from "lucide-react";
import {
	AgentLoopDiagram,
	MultiAgentDiagram,
	PackageDependencyGraph,
	RuntimeAdapterDiagram,
	SessionGraphVisual,
	SessionStorageDiagram,
	StreamingModelDiagram,
} from "@/components/diagram";
import {
	adapterCapabilities,
	adapterEnables,
	agentLoopComparison,
	browserUsageGuidelines,
	comparisonTable,
	deepDiveSections,
	entrypointMatrix,
	keyDecisions,
	keyShifts,
	missingFeatures,
	multiAgentComparison,
	overviewStats,
	packages,
	providerComparison,
	sessionComparison,
	toolConsolidation,
} from "@/lib/architecture-data";

import { cn } from "@/lib/utils";
import { Button } from "./ui/button";

interface WelcomePageProps {
	onNavigateToVisualizer: () => void;
}

const providerSupportDelta = [
	{ provider: "opencode", old: "Not built-in", current: "Built-in handler" },
	{ provider: "asksage", old: "Built-in", current: "Not built-in yet" },
	{ provider: "dify", old: "Built-in", current: "Not built-in yet" },
	{ provider: "minimax", old: "Built-in", current: "Not built-in yet" },
	{ provider: "mistral", old: "Built-in", current: "Not built-in yet" },
	{
		provider: "vscode-lm",
		old: "Built-in",
		current: "Client-hosted (registerHandler)",
	},
];

const providerQualityGains = [
	"Public providers API (`providers.createHandler`, `createHandlerAsync`, `resolveProviderConfig`) replaces internal-only wiring.",
	"OpenAI-compatible provider discovery is centralized and reused across runtime defaults, catalog views, and model scripts.",
	"Provider ID normalization is shared (`openai` -> `openai-native`) across auth, routing, and call sites.",
	"Known model metadata is backfilled for non-OpenAI-compatible providers, improving usage pricing/cost accounting.",
];

export function WelcomePage({ onNavigateToVisualizer }: WelcomePageProps) {
	return (
		<div className="min-h-screen bg-zinc-950 text-zinc-100">
			{/* Sidebar Navigation */}
			<nav className="fixed top-0 left-0 bottom-0 w-64 bg-zinc-900/50 border-r border-zinc-800 overflow-y-auto z-50 hidden lg:block">
				<div className="p-5 border-b border-zinc-800">
					<h1 className="text-xs font-semibold text-cyan-400 uppercase tracking-wider">
						Cline SDK - WIP
					</h1>
					<p className="text-[11px] text-zinc-600 mt-1">
						https://github.com/cline/sdk-wip
					</p>
				</div>

				<div className="py-3">
					<div className="px-5 py-1.5 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
						Overview
					</div>
					<a
						href="#overview"
						className="flex items-baseline gap-2 px-5 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border-l-2 border-transparent hover:border-cyan-500 transition-colors"
					>
						<span className="text-[10px] text-zinc-600 w-4">00</span>
						Executive Summary
					</a>

					<div className="px-5 py-1.5 mt-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
						Deep Dives
					</div>
					{deepDiveSections.map((section) => (
						<a
							key={section.id}
							href={`#${section.id}`}
							className="flex items-baseline gap-2 px-5 py-1.5 text-[13px] text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 border-l-2 border-transparent hover:border-cyan-500 transition-colors"
						>
							<span className="text-[10px] text-zinc-600 w-4">
								{section.num}
							</span>
							{section.title}
						</a>
					))}

					<div className="px-5 py-1.5 mt-2 text-[10px] font-semibold text-zinc-600 uppercase tracking-wider">
						Interactive
					</div>

					<Button
						onClick={onNavigateToVisualizer}
						variant="default"
						className="w-full flex items-center justify-start gap-2 px-5 py-2 transition-colors rounded-none"
					>
						<Play className="w-3.5 h-3.5" />
						Lifecycle Visualizer
					</Button>
				</div>
			</nav>

			{/* Main Content */}
			<main className="lg:ml-64">
				{/* Hero Section */}
				<header
					id="overview"
					className="relative px-8 lg:px-14 py-14 border-b border-zinc-800 bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-900/80 overflow-hidden"
				>
					<div className="absolute -top-16 -right-16 w-80 h-80 bg-cyan-500/5 rounded-full blur-3xl pointer-events-none" />

					<div className="inline-flex items-center gap-1.5 bg-cyan-500/10 border border-cyan-500/20 rounded-full px-3 py-1 text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-5">
						Architecture Analysis
					</div>

					<h1 className="text-3xl lg:text-4xl font-bold tracking-tight text-zinc-100 mb-4">
						Cline → <span className="text-cyan-400">SDK-WIP</span> Rewrite
					</h1>

					<p className="text-base text-zinc-400 max-w-2xl leading-relaxed border-l-2 border-cyan-500 pl-4 italic mb-8">
						The refactor moves from &quot;a VS Code extension that happens to
						have an agent&quot; to &quot;an agent SDK that happens to ship in a
						VS Code extension (and a CLI, and a desktop app).&quot;
					</p>

					<div className="flex flex-wrap gap-8">
						{overviewStats.map((stat) => (
							<div key={stat.label} className="flex flex-col gap-0.5">
								<span className="text-3xl font-bold text-cyan-400 tabular-nums">
									{stat.value}
								</span>
								<span className="text-[11px] text-zinc-600 uppercase tracking-wider">
									{stat.label}
								</span>
							</div>
						))}
					</div>

					{/* CTA Button */}
					<Button
						onClick={onNavigateToVisualizer}
						className="mt-8 inline-flex items-center gap-2 px-5 py-2.5 bg-cyan-500/20 hover:bg-cyan-500/30 border border-cyan-500/30 rounded-lg text-sm font-medium text-cyan-400 transition-colors"
					>
						<Play className="w-4 h-4" />
						Launch Lifecycle Visualizer
						<ArrowRight className="w-4 h-4" />
					</Button>
				</header>

				{/* Latest Agent Runtime Updates */}
				<section className="px-8 lg:px-14 py-10 border-b border-zinc-800 bg-zinc-900/30">
					<div className="flex items-start gap-4 mb-6">
						<div className="flex items-center justify-center w-9 h-9 bg-emerald-600 rounded-lg text-sm font-bold text-white shrink-0">
							New
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Latest Agent Runtime Changes
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								Current docs reflect the new package boundary: agents emit hook
								events, core owns hook execution, and Node-only subprocess APIs
								move to a dedicated entrypoint.
							</p>
						</div>
					</div>

					<div className="grid md:grid-cols-2 xl:grid-cols-4 gap-3">
						<div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
								Agents Entrypoints
							</div>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								`@cline/agents` default export path is env-agnostic, while
								subprocess hook APIs now live in `@cline/agents/node`.
							</p>
						</div>
						<div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
								Hooks Boundary
							</div>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Agent runtime hooks now map to event payloads only; command
								execution moved upstream into `@cline/core` runtime wiring.
							</p>
						</div>
						<div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
								Core Hook Execution
							</div>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Hook files now resolve via shebang/extension interpreter rules
								(`bash`, `node`, `bun run`) to avoid `EACCES` on non-executable
								files.
							</p>
						</div>
						<div className="bg-zinc-900/60 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
								File Input Portability
							</div>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Agent input loading now uses injected `userFileContentLoader`
								instead of Node fs in the default path, keeping browser usage
								compatible.
							</p>
						</div>
					</div>

					<Button
						onClick={onNavigateToVisualizer}
						className="mt-6 inline-flex items-center gap-2 px-4 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg text-sm font-medium text-emerald-400 transition-colors"
					>
						<Play className="w-4 h-4" />
						Explore Updated Hook Lifecycle
					</Button>
				</section>

				{/* Browser / Node Entrypoints */}
				<section className="px-8 lg:px-14 py-10 border-b border-zinc-800">
					<div className="flex items-start gap-4 mb-6">
						<div className="flex items-center justify-center w-9 h-9 bg-sky-600 rounded-lg text-sm font-bold text-white shrink-0">
							Env
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Browser vs Node Entrypoints
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								What can run in browser, what must stay in Node, and how to wire
								`@cline/llms` for browser use.
							</p>
						</div>
					</div>

					<div className="overflow-x-auto rounded-lg border border-zinc-800 mb-6">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Package
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Browser
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Node
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Usage Notes
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{entrypointMatrix.map((row) => (
									<tr key={row.pkg} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-mono text-zinc-200 whitespace-nowrap">
											{row.pkg}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.browser}</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.node}</td>
										<td className="px-4 py-2.5 text-zinc-500">{row.notes}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5">
						<h3 className="text-sm font-semibold text-zinc-100 mb-3">
							Recommended Browser Usage
						</h3>
						<div className="space-y-2">
							{browserUsageGuidelines.map((rule, i) => (
								<div key={i} className="flex items-start gap-2 text-[13px]">
									<span className="text-sky-400 mt-0.5">{i + 1}.</span>
									<span className="text-zinc-400 leading-relaxed">{rule}</span>
								</div>
							))}
						</div>
						<div className="mt-4 rounded border border-sky-500/20 bg-sky-500/5 p-3">
							<p className="text-[12px] text-sky-300 font-medium mb-1">
								Browser import example
							</p>
							<code className="text-[11px] text-zinc-300 font-mono">
								import {"{ providers, models }"} from "@cline/llms/browser"
							</code>
						</div>
						<div className="mt-3 rounded border border-sky-500/20 bg-sky-500/5 p-3">
							<p className="text-[12px] text-sky-300 font-medium mb-1">
								Agents package boundary
							</p>
							<code className="text-[11px] text-zinc-300 font-mono">
								import {"{ Agent }"} from "@cline/agents"
							</code>
							<p className="mt-2 text-[11px] text-zinc-500 leading-relaxed">
								Use `@cline/agents/node` only in Node runtimes when you need
								subprocess hook helpers.
							</p>
						</div>
					</div>
				</section>

				{/* High-Level Comparison */}
				<section className="px-8 lg:px-14 py-12 border-b border-zinc-800">
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							00
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								High-Level Comparison
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								Ground-up rewrite: monolithic extension to modular SDK
							</p>
						</div>
					</div>

					<div className="overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Dimension
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original Cline
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										SDK-WIP
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{comparisonTable.map((row) => (
									<tr key={row.dimension} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200 whitespace-nowrap">
											{row.dimension}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">
											{row.original}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.new}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Key Conceptual Shifts */}
					<h3 className="text-lg font-semibold text-zinc-100 mt-10 mb-4">
						Key Conceptual Shifts
					</h3>
					<div className="grid md:grid-cols-2 gap-3">
						{keyShifts.map((shift, i) => (
							<div
								key={i}
								className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 hover:border-cyan-500/30 transition-colors"
							>
								<div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-1.5">
									Shift {i + 1}
								</div>
								<h4 className="text-sm font-semibold text-zinc-100 mb-2">
									{shift.title}
								</h4>
								<p className="text-[13px] text-zinc-500 leading-relaxed">
									{shift.description}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* Package Map */}
				<section
					id="packages"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							01
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Package Map & Dependency Graph
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								Monolith decomposed into 5 SDK packages (+ shared) with enforced
								boundaries
							</p>
						</div>
					</div>

					{/* Compare Cards */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-amber-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-amber-400 mb-2">
								Original Cline — Monolith
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Everything in one src/ directory. Task depends on VS Code APIs,
								webview messaging, terminal, diff views, browser service. Tool
								handlers reach back into the Task class for state mutation. No
								clean boundary between agent logic and VS Code integration.
							</p>
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-emerald-400 mb-2">
								SDK-WIP — Multi-Package Workspace
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Strict one-way dependency graph. llms is a leaf with no internal
								deps. agents depends only on llms. core depends on llms +
								agents. rpc provides gRPC gateway. shared provides contracts.
								cli, code, and desktop are thin app shells. Boundaries enforced
								by bun run check:boundaries.
							</p>
						</div>
					</div>

					{/* Interactive Dependency Diagram */}
					<div className="bg-zinc-900/80 border border-zinc-800 rounded-lg mb-6">
						<PackageDependencyGraph />
					</div>

					{/* Package Cards */}
					<div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
						{packages.map((pkg) => (
							<div
								key={pkg.name}
								className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4"
							>
								<div className="text-sm font-semibold font-mono text-cyan-400 mb-1.5">
									{pkg.name}
								</div>
								<p className="text-[12px] text-zinc-500 leading-relaxed">
									{pkg.description}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* Agent Loop */}
				<section
					id="agent-loop"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							02
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								The Agentic Loop
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								The most important document — the heart of both systems
							</p>
						</div>
					</div>

					{/* Callout */}
					<div className="bg-cyan-500/5 border-l-4 border-cyan-500 rounded-r-lg p-4 mb-6">
						<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-1">
							Core Reduction
						</strong>
						<p className="text-[13px] text-zinc-400 leading-relaxed">
							The Task class shrinks from ~3,500 lines with 3 nested loops and
							40+ state flags to ~1,400 lines with a single while-loop and ~15
							instance fields. The key trade: interleaved streaming execution
							for simplicity, testability, and platform independence.
						</p>
					</div>

					{/* Interactive Loop Structure Comparison */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-mono text-amber-400 mb-3">
								Original Cline — Task class loop structure
							</div>
							<AgentLoopDiagram variant="original" />
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-mono text-emerald-400 mb-3">
								SDK-WIP — Agent class loop structure
							</div>
							<AgentLoopDiagram variant="new" />
						</div>
					</div>

					{/* Streaming Model Difference */}
					<h3 className="text-base font-semibold text-zinc-100 mb-4">
						The Streaming Model Difference
					</h3>
					<p className="text-[13px] text-zinc-500 mb-4">
						This is a critical detail. The original interleaves streaming and
						tool execution; the new system streams fully, then executes.
					</p>

					{/* Interactive Streaming Model Comparison */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-amber-500 rounded-lg p-4">
							<StreamingModelDiagram variant="interleaved" />
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-lg p-4">
							<StreamingModelDiagram variant="sequential" />
						</div>
					</div>

					{/* Comparison Table */}
					<div className="overflow-x-auto rounded-lg border border-zinc-800 mb-6">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Aspect
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original Task
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										New Agent
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{agentLoopComparison.map((row) => (
									<tr key={row.aspect} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200 whitespace-nowrap">
											{row.aspect}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">
											{row.original}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.new}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{/* Gains and Tradeoffs */}
					<div className="grid md:grid-cols-2 gap-3">
						<div className="bg-emerald-500/5 border-l-4 border-emerald-500 rounded-r-lg p-4">
							<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-1">
								Gains
							</strong>
							<p className="text-[13px] text-zinc-400 leading-relaxed">
								~2.5x smaller core loop. Platform independence (same agent runs
								in CLI, desktop, CI). Testability. Composability (agents can
								contain agents). Type-safe tool inputs. Clean extension model
								via hooks.
							</p>
						</div>
						<div className="bg-amber-500/5 border-l-4 border-amber-500 rounded-r-lg p-4">
							<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-1">
								Tradeoffs
							</strong>
							<p className="text-[13px] text-zinc-400 leading-relaxed">
								No interleaved execution — slightly higher perceived latency.
								Loss of rich inline diff views, checkpoint management woven into
								the loop. Simpler context management may need to grow.
							</p>
						</div>
					</div>
				</section>

				{/* Tool System */}
				<section
					id="tool-system"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							03
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">Tool System</h2>
							<p className="text-sm text-zinc-500 mt-1">
								Definition, parsing, execution, and approval — where the biggest
								mechanical differences live
							</p>
						</div>
					</div>

					{/* Compare Cards */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-amber-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-amber-400 mb-2">
								Original — XML + Enum (~25 tools)
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Tools defined as a string enum. Schemas as XML descriptions in
								the system prompt. Custom streaming XML parser. All parameters
								are strings with no schema validation. Per-tool handler classes
								(~25 files) that mutate Task state directly. Approval hardcoded
								per tool via webview ask/say.
							</p>
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-emerald-400 mb-2">
								SDK-WIP — Zod + Registry (7 tools)
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								Tools created with createTool() + Zod schemas auto-converted to
								JSON Schema. Typed input/output. Per-tool timeout + retry
								config. Pure functions with context injection. Generic execution
								engine. Declarative toolPolicies + pluggable onToolCall hook.
							</p>
						</div>
					</div>

					<h3 className="text-base font-semibold text-zinc-100 mb-4">
						Tool Consolidation: 25 → 7
					</h3>

					<div className="overflow-x-auto rounded-lg border border-zinc-800 mb-6">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original Tools
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										New Equivalent
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{toolConsolidation.map((row, i) => (
									<tr key={i} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-mono text-[12px] text-zinc-200">
											{row.original}
										</td>
										<td className="px-4 py-2.5 font-mono text-[12px] text-cyan-400">
											{row.new}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<p className="text-[13px] text-zinc-500">
						Philosophy:{" "}
						<strong className="text-zinc-200">fewer, more capable tools</strong>{" "}
						with batched operations vs. many single-purpose tools. The 7 builtin
						tools are a starting point, not a ceiling — extensions can register
						additional tools.
					</p>
				</section>

				{/* Provider & Model Management */}
				<section
					id="providers"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							04
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Provider & Model Management
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								From a giant switch factory to SDK-first wrappers with
								auto-generated catalogs
							</p>
						</div>
					</div>

					{/* Compare Cards */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-amber-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-amber-400 mb-2">
								Original — Giant Switch + Flat Config
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								45+ custom handler files. One massive ApiConfiguration interface
								with 100+ flat fields covering every provider. Factory is a
								giant switch statement manually destructuring provider-specific
								fields. Model catalog hardcoded in source.
							</p>
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-lg p-5">
							<h4 className="text-sm font-semibold text-emerald-400 mb-2">
								SDK-WIP — SDK-First Handler Bases + Typed Schemas
							</h4>
							<p className="text-[13px] text-zinc-500 leading-relaxed">
								SDK-first handler bases (Anthropic, OpenAI-compatible, Bedrock,
								Gemini, Vertex, R1, community SDK) cover all providers.
								Per-provider Zod schemas with discriminated union on provider
								field. Model catalog auto-generated via bun run build:models.
								Model updates are a script run, not a code change.
							</p>
						</div>
					</div>

					{/* Callout */}
					<div className="bg-cyan-500/5 border-l-4 border-cyan-500 rounded-r-lg p-4 mb-6">
						<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-1">
							Key Insight
						</strong>
						<p className="text-[13px] text-zinc-400 leading-relaxed">
							Most providers speak OpenAI-compatible API. The OpenAI-compatible
							handler base alone covers ~30+ providers, while dedicated bases
							exist for Anthropic, Bedrock, Gemini, Vertex, R1, and community
							SDK providers. The official SDKs handle auth, retries, streaming,
							and error parsing.
						</p>
					</div>

					{/* Comparison Table */}
					<div className="overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Aspect
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										SDK-WIP
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{providerComparison.map((row) => (
									<tr key={row.aspect} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200 whitespace-nowrap">
											{row.aspect}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">
											{row.original}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.new}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="mt-6 grid md:grid-cols-3 gap-3">
						<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-1">
								Built-in Coverage
							</div>
							<p className="text-[13px] text-zinc-400 leading-relaxed">
								37 of 42 legacy providers are now built-in in `@cline/llms`.
							</p>
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
								New Built-in Route
							</div>
							<p className="text-[13px] text-zinc-400 leading-relaxed">
								`opencode` is now built-in in SDK-WIP (was not built-in in
								legacy Cline).
							</p>
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-4">
							<div className="text-[11px] font-semibold text-amber-400 uppercase tracking-wider mb-1">
								Out-of-Scope Route
							</div>
							<p className="text-[13px] text-zinc-400 leading-relaxed">
								`vscode-lm` moved to a client-hosted model: hosts register it
								via `registerHandler()` / `registerAsyncHandler()`.
							</p>
						</div>
					</div>

					<div className="mt-6 overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Provider
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Legacy
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										SDK-WIP
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{providerSupportDelta.map((row) => (
									<tr key={row.provider} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-mono text-zinc-200">
											{row.provider}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.old}</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.current}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					<div className="mt-6 bg-emerald-500/5 border-l-4 border-emerald-500 rounded-r-lg p-4">
						<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-2">
							Why Provider Support Is Better Now
						</strong>
						<div className="space-y-2">
							{providerQualityGains.map((gain) => (
								<p
									key={gain}
									className="text-[13px] text-zinc-400 leading-relaxed"
								>
									{gain}
								</p>
							))}
						</div>
					</div>
				</section>

				{/* Session & Storage */}
				<section
					id="storage"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							05
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Session & Storage
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								From VS Code globalState to a database-backed session service
							</p>
						</div>
					</div>

					{/* Interactive Mental Model Diagrams */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div>
							<div className="text-[11px] font-mono text-amber-400 mb-2">
								Original Mental Model
							</div>
							<SessionStorageDiagram variant="original" />
						</div>
						<div>
							<div className="text-[11px] font-mono text-emerald-400 mb-2">
								SDK-WIP Mental Model
							</div>
							<SessionStorageDiagram variant="new" />
						</div>
					</div>

					{/* Interactive Session Graph */}
					<h3 className="text-base font-semibold text-zinc-100 mb-3">
						Session Graph — Hierarchical IDs
					</h3>
					<p className="text-[13px] text-zinc-500 mb-3">
						Session IDs encode parent-child relationships, enabling cascade
						operations and hierarchical queries:
					</p>
					<SessionGraphVisual />

					{/* Comparison Table */}
					<div className="overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Aspect
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										SDK-WIP
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{sessionComparison.map((row) => (
									<tr key={row.aspect} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200 whitespace-nowrap">
											{row.aspect}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">
											{row.original}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.new}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				{/* Multi-Agent */}
				<section
					id="multi-agent"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							06
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">Multi-Agent</h2>
							<p className="text-sm text-zinc-500 mt-1">
								From bolted-on subagents to first-class teams with persistent
								orchestration
							</p>
						</div>
					</div>

					{/* Interactive Architecture Diagrams */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-amber-500 rounded-lg">
							<div className="text-[11px] font-mono text-amber-400 px-4 pt-3">
								Original: Tools that spawn tasks
							</div>
							<MultiAgentDiagram variant="original" />
						</div>
						<div className="bg-zinc-900/50 border border-zinc-800 border-t-2 border-t-emerald-500 rounded-lg">
							<div className="text-[11px] font-mono text-emerald-400 px-4 pt-3">
								New: Autonomous team with orchestrator
							</div>
							<MultiAgentDiagram variant="new" />
						</div>
					</div>

					{/* Comparison Table */}
					<div className="overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Aspect
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Original Subagents
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										SDK-WIP Teams
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{multiAgentComparison.map((row) => (
									<tr key={row.aspect} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200 whitespace-nowrap">
											{row.aspect}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">
											{row.original}
										</td>
										<td className="px-4 py-2.5 text-zinc-400">{row.new}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				{/* Runtime Host Integration */}
				<section
					id="runtime-hosts"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							07
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Runtime Host Integration
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								How CLI, Code, and Desktop wire the shared SDK runtime in
								today&apos;s architecture
							</p>
						</div>
					</div>

					{/* Callout */}
					<div className="bg-cyan-500/5 border-l-4 border-cyan-500 rounded-r-lg p-4 mb-6">
						<strong className="block text-[11px] text-zinc-100 uppercase tracking-wider mb-1">
							Why This Exists
						</strong>
						<p className="text-[13px] text-zinc-400 leading-relaxed">
							In original Cline, the Task class IS the runtime. It directly owns
							VS Code APIs, tool execution, UI interaction, file I/O, terminal
							management, and state persistence. You can&apos;t run a Cline
							agent outside VS Code. SDK-WIP separates runtime concerns into
							core/agents packages, and host apps wire them through concrete
							runtime entrypoints (session manager + runtime bridge scripts).
						</p>
					</div>

					{/* Interactive Architecture Diagram */}
					<div className="bg-zinc-900/50 border border-zinc-800 rounded-lg mb-6">
						<RuntimeAdapterDiagram />
					</div>

					<p className="text-[13px] text-zinc-500 mb-4">
						The same Agent instance works identically in all environments. Apps
						compose runtime/session services with platform-specific hooks,
						approval callbacks, and event delivery:
					</p>

					{/* Adapter Cards */}
					<div className="grid md:grid-cols-2 gap-3 mb-6">
						{adapterCapabilities.map((adapter) => (
							<div
								key={adapter.name}
								className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 hover:border-cyan-500/30 transition-colors"
							>
								<div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-1">
									{adapter.name}
								</div>
								<h4 className="text-sm font-semibold text-zinc-100 mb-2">
									{adapter.subtitle}
								</h4>
								<p className="text-[13px] text-zinc-500 leading-relaxed">
									{adapter.description}
								</p>
							</div>
						))}
					</div>

					<h3 className="text-base font-semibold text-zinc-100 mb-4">
						What This Enables
					</h3>
					<div className="grid md:grid-cols-2 gap-3">
						{adapterEnables.map((item, i) => (
							<div
								key={i}
								className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 hover:border-cyan-500/30 transition-colors"
							>
								<h4 className="text-sm font-semibold text-zinc-100 mb-2">
									{item.title}
								</h4>
								<p className="text-[13px] text-zinc-500 leading-relaxed">
									{item.description}
								</p>
							</div>
						))}
					</div>
				</section>

				{/* Key Decisions */}
				<section
					id="decisions"
					className="px-8 lg:px-14 py-12 border-b border-zinc-800"
				>
					<div className="flex items-start gap-4 mb-8">
						<div className="flex items-center justify-center w-9 h-9 bg-cyan-600 rounded-lg text-sm font-bold text-white shrink-0">
							08
						</div>
						<div>
							<h2 className="text-xl font-bold text-zinc-100">
								Key Architectural Decisions & Tradeoffs
							</h2>
							<p className="text-sm text-zinc-500 mt-1">
								10 consequential decisions and what they imply
							</p>
						</div>
					</div>

					<div className="grid md:grid-cols-2 gap-3 mb-8">
						{keyDecisions.map((decision) => (
							<div
								key={decision.num}
								className="bg-zinc-900/50 border border-zinc-800 rounded-lg p-5 hover:border-cyan-500/30 transition-colors"
							>
								<div className="text-[11px] font-semibold text-cyan-400 uppercase tracking-wider mb-1.5">
									{decision.num}
								</div>
								<h4 className="text-sm font-semibold text-zinc-100 mb-2">
									{decision.title}
								</h4>
								<p className="text-[13px] text-zinc-500 leading-relaxed">
									{decision.description}
								</p>
							</div>
						))}
					</div>

					{/* Missing Features */}
					<h3 className="text-base font-semibold text-zinc-100 mb-4">
						What&apos;s Missing (Gaps vs. Original)
					</h3>

					<div className="overflow-x-auto rounded-lg border border-zinc-800">
						<table className="w-full text-sm">
							<thead className="bg-zinc-900/80">
								<tr>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Feature
									</th>
									<th className="px-4 py-3 text-left text-[11px] font-semibold text-zinc-500 uppercase tracking-wider">
										Status in SDK-WIP
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-zinc-800/60">
								{missingFeatures.map((row) => (
									<tr key={row.feature} className="hover:bg-zinc-900/30">
										<td className="px-4 py-2.5 font-medium text-zinc-200">
											{row.feature}
										</td>
										<td className="px-4 py-2.5">
											<span
												className={cn(
													"inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold",
													row.status === "not-implemented" &&
														"bg-red-500/15 text-red-400",
													row.status === "adapter-dependent" &&
														"bg-amber-500/15 text-amber-400",
													row.status === "simplified" &&
														"bg-amber-500/15 text-amber-400",
												)}
											>
												{row.status === "not-implemented"
													? "Not implemented"
													: row.status === "adapter-dependent"
														? "Adapter-dependent"
														: "Simplified"}
											</span>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				</section>

				{/* Footer CTA */}
				<section className="px-8 lg:px-14 py-12">
					<div className="bg-gradient-to-br from-cyan-500/10 to-cyan-500/5 border border-cyan-500/20 rounded-xl p-8 text-center">
						<h3 className="text-xl font-bold text-zinc-100 mb-2">
							Explore the Lifecycle Flow
						</h3>
						<p className="text-sm text-zinc-400 mb-6 max-w-lg mx-auto">
							See how sessions flow through packages from startup to prompt
							execution and streaming events with our interactive visualizer.
						</p>
						<Button
							onClick={onNavigateToVisualizer}
							className="inline-flex items-center gap-2 px-6 py-3 bg-cyan-500 hover:bg-cyan-400 rounded-lg text-sm font-semibold text-zinc-950 transition-colors"
						>
							<Play className="w-4 h-4" />
							Launch Lifecycle Visualizer
							<ArrowRight className="w-4 h-4" />
						</Button>
					</div>
				</section>
			</main>
		</div>
	);
}
