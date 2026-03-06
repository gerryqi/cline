"use client";

import type { Step, TransportType } from "@/lib/lifecycle-data";
import { cn } from "@/lib/utils";
import { Button } from "../ui/button";

interface TimelineProps {
	steps: Step[];
	currentStep: number;
	onStepClick: (index: number) => void;
}

function TransportDot({
	type,
	isActive,
}: {
	type: TransportType;
	isActive: boolean;
}) {
	const colors: Record<TransportType, string> = {
		rpc: "bg-emerald-500",
		ws: "bg-amber-500",
		local: "bg-zinc-500",
	};

	return (
		<span
			className={cn("relative flex h-3 w-3 shrink-0", isActive && "h-4 w-4")}
		>
			{isActive && (
				<span
					className={cn(
						"absolute inline-flex h-full w-full animate-ping rounded-full opacity-75",
						colors[type],
					)}
				/>
			)}
			<span
				className={cn(
					"relative inline-flex h-full w-full rounded-full",
					colors[type],
				)}
			/>
		</span>
	);
}

export function Timeline({ steps, currentStep, onStepClick }: TimelineProps) {
	return (
		<div className="relative">
			{/* Vertical line */}
			<div className="absolute left-[7px] top-2 bottom-2 w-px bg-zinc-700" />

			<div className="space-y-1">
				{steps.map((step, index) => {
					const isActive = index === currentStep;
					const isDone = index < currentStep;

					return (
						<Button
							key={index}
							onClick={() => onStepClick(index)}
							className={cn(
								"relative flex items-start gap-3 w-full text-left px-2 py-2 rounded-lg transition-all duration-200",
								"hover:bg-zinc-800/50",
								isActive && "bg-zinc-800/80",
								isDone && "opacity-60",
							)}
						>
							<div className="relative z-10 mt-0.5">
								{isDone ? (
									<span className="flex h-3.5 w-3.5 items-center justify-center rounded-full bg-emerald-500/20 ring-1 ring-emerald-500/50">
										<span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
									</span>
								) : (
									<TransportDot type={step.transport} isActive={isActive} />
								)}
							</div>

							<div className="flex-1 min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-[10px] font-medium text-zinc-500">
										{index + 1}
									</span>
									<span
										className={cn(
											"text-sm font-medium truncate",
											isActive ? "text-zinc-100" : "text-zinc-400",
										)}
									>
										{step.title}
									</span>
								</div>
							</div>
						</Button>
					);
				})}
			</div>
		</div>
	);
}
