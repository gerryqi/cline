"use client";

import { ArrowRight } from "lucide-react";
import type { Step, TransportType } from "@/lib/lifecycle-data";
import { packages } from "@/lib/lifecycle-data";
import { cn } from "@/lib/utils";

interface StepDetailsProps {
	stepNumber: number;
	totalSteps: number;
	step: Step;
}

function TransportBadge({ type }: { type: TransportType }) {
	const config: Record<TransportType, { label: string; className: string }> = {
		rpc: {
			label: "gRPC / RPC",
			className: "border-emerald-500/50 bg-emerald-500/10 text-emerald-400",
		},
		ws: {
			label: "WebSocket",
			className: "border-amber-500/50 bg-amber-500/10 text-amber-400",
		},
		local: {
			label: "Local / In-process",
			className: "border-zinc-500/50 bg-zinc-500/10 text-zinc-400",
		},
	};

	const { label, className } = config[type];

	return (
		<span
			className={cn(
				"inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium",
				className,
			)}
		>
			{label}
		</span>
	);
}

export function StepDetails({
	stepNumber,
	totalSteps,
	step,
}: StepDetailsProps) {
	return (
		<div className="space-y-6">
			{/* Header */}
			<div>
				<div className="flex items-center gap-3 mb-2">
					<span className="text-xs font-medium text-zinc-500">
						Step {stepNumber} of {totalSteps}
					</span>
					<TransportBadge type={step.transport} />
				</div>
				<h2 className="text-xl font-semibold text-zinc-100 tracking-tight">
					{step.title}
				</h2>
				<p className="mt-2 text-sm text-zinc-400 leading-relaxed">
					{step.summary}
				</p>
			</div>

			{/* Package Flow */}
			<div>
				<h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
					Package Flow
				</h3>
				<div className="flex flex-wrap items-center gap-2">
					{step.packages.map((pkg, i) => (
						<div key={pkg} className="flex items-center gap-2">
							<span className="rounded-md border border-cyan-500/50 bg-cyan-500/10 px-2.5 py-1.5 text-xs font-mono text-cyan-300">
								{pkg}
							</span>
							{i < step.packages.length - 1 && (
								<ArrowRight className={cn("w-3 h-3 text-zinc-600")} />
							)}
						</div>
					))}
				</div>
			</div>

			{/* Methods/Events */}
			<div>
				<h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
					Methods / Events
				</h3>
				<div className="flex flex-wrap gap-2">
					{step.methods.map((method, i) => (
						<code
							key={i}
							className="rounded-md bg-zinc-800 px-2.5 py-1.5 text-xs font-mono text-zinc-300"
						>
							{method}
						</code>
					))}
				</div>
			</div>

			{/* All Packages State */}
			<div>
				<h3 className="text-xs font-medium text-zinc-500 uppercase tracking-wider mb-3">
					All Packages
				</h3>
				<div className="grid grid-cols-2 gap-2">
					{packages.map((pkg) => {
						const isActive = step.packages.includes(pkg);
						return (
							<div
								key={pkg}
								className={cn(
									"rounded-md border px-2.5 py-1.5 text-xs font-mono transition-all duration-300",
									isActive
										? "border-cyan-500/50 bg-cyan-500/10 text-cyan-300"
										: "border-zinc-800 bg-zinc-900/50 text-zinc-600",
								)}
							>
								{pkg}
							</div>
						);
					})}
				</div>
			</div>
		</div>
	);
}
