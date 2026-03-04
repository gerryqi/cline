"use client";

import {
	ArrowRight,
	Bot,
	LogIn,
	MessageSquare,
	NotebookText,
	TerminalIcon,
	Users,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@/components/ui/popover";
import { UserNav } from "@/components/user-nav";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

const products = [
	{
		id: "agent-board",
		name: "Kanban Board",
		description:
			"Track and monitor Cline agents in real time with a visual kanban workflow.",
		icon: Bot,
		href: "/board",
		available: true,
		accent: "primary",
	},
	{
		id: "agent-team",
		name: "Agent Team",
		description:
			"Create a task for a team of Cline agents to collaborate on and track their progress together.",
		icon: Users,
		href: "/team",
		available: true,
		accent: "chart-2",
	},
	{
		id: "agent-chat",
		name: "Agent Chat",
		description:
			"Use the CLI agent runtime in an interactive desktop chat interface.",
		icon: MessageSquare,
		href: "/chat",
		available: true,
		accent: "chart-4",
	},
	{
		id: "sdk-playground",
		name: "SDK Playground",
		description: "Experiment with different providers and configurations.",
		icon: TerminalIcon,
		href: "/playground",
		available: true,
		accent: "chart-3",
	},
	{
		id: "agent-logs",
		name: "Agent Logs",
		description: "View and analyze logs across your team in real time.",
		icon: NotebookText,
		href: "#",
		available: false,
		accent: "chart-5",
	},
];

function SignInCard() {
	const { signIn } = useAuth();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");

	function handleSubmit(e: React.FormEvent) {
		e.preventDefault();
		if (email.trim()) {
			signIn(email, password);
		}
	}

	return (
		<div className="w-full min-w-[320px] max-w-sm rounded-xl border border-border bg-card p-6">
			<div className="mb-5 flex items-center gap-2">
				<LogIn className="h-4 w-4 text-primary" />
				<h3 className="text-sm font-semibold text-foreground">
					Sign in to your account
				</h3>
			</div>
			<form className="flex flex-col gap-4" onSubmit={handleSubmit}>
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground" htmlFor="email">
						Email
					</Label>
					<Input
						className="h-9 border-border bg-background text-sm text-foreground"
						id="email"
						onChange={(e) => setEmail(e.target.value)}
						placeholder="you@cline.bot"
						required
						type="email"
						value={email}
					/>
				</div>
				<div className="flex flex-col gap-1.5">
					<Label className="text-xs text-muted-foreground" htmlFor="password">
						Password
					</Label>
					<Input
						className="h-9 border-border bg-background text-sm text-foreground"
						id="password"
						onChange={(e) => setPassword(e.target.value)}
						placeholder="Enter your password"
						required
						type="password"
						value={password}
					/>
				</div>
				<Button className="mt-1 w-full" size="sm" type="submit">
					Sign In
				</Button>
			</form>
		</div>
	);
}

function ProductCard({ product }: { product: (typeof products)[number] }) {
	const content = (
		<div
			className={cn(
				"group relative flex flex-col gap-4 rounded-xl border border-border bg-card p-5 transition-all duration-200",
				product.available
					? "cursor-pointer hover:border-primary/40 hover:bg-card/80 hover:shadow-lg hover:shadow-primary/5"
					: "opacity-50 cursor-default",
			)}
		>
			{!product.available && (
				<span className="absolute right-3 top-3 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
					Coming Soon
				</span>
			)}
			<div
				className={cn(
					"flex h-10 w-10 items-center justify-center rounded-lg",
					product.available ? "bg-primary/10" : "bg-muted",
				)}
			>
				<product.icon
					className={cn(
						"h-5 w-5",
						product.available ? "text-primary" : "text-muted-foreground",
					)}
				/>
			</div>
			<div className="flex flex-col gap-1.5">
				<h3 className="text-sm font-semibold text-foreground">
					{product.name}
				</h3>
				<p className="text-xs leading-relaxed text-muted-foreground">
					{product.description}
				</p>
			</div>
			{product.available && (
				<div className="mt-auto flex items-center gap-1 text-xs font-medium text-primary opacity-0 transition-opacity group-hover:opacity-100">
					<span>Open</span>
					<ArrowRight className="h-3 w-3" />
				</div>
			)}
		</div>
	);

	if (product.available) {
		return <Link href={product.href}>{content}</Link>;
	}

	return content;
}

export function WelcomeScreen() {
	const { isAuthenticated, user } = useAuth();

	return (
		<div className="flex min-h-[100dvh] flex-col">
			{/* Nav bar */}
			<header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
				<div className="flex items-center gap-3">
					<h1 className="text-base font-semibold text-foreground sm:text-lg">
						Cline
					</h1>
				</div>
				<div className="flex items-center gap-3">
					{isAuthenticated && user ? (
						<div className="flex items-center gap-3">
							<span className="hidden text-xs text-muted-foreground sm:block">
								{user.name}
							</span>
							<UserNav />
						</div>
					) : (
						<Popover>
							<PopoverTrigger asChild>
								<Button id="header-sign-in-button" size="sm" variant="ghost">
									Sign In
								</Button>
							</PopoverTrigger>
							<PopoverContent
								align="end"
								className="w-auto border-none bg-transparent p-0 shadow-none"
							>
								<SignInCard />
							</PopoverContent>
						</Popover>
					)}
				</div>
			</header>

			{/* Main content */}
			<main className="flex flex-1 flex-col items-center px-4 py-10 sm:px-6 sm:py-16">
				{/* Hero */}
				<div className="mb-10 flex max-w-lg flex-col items-center text-center sm:mb-14">
					<div className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1">
						<span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-primary" />
						<span className="text-[11px] font-medium text-muted-foreground">
							Platform v1.0
						</span>
					</div>
					<h2 className="text-balance text-2xl font-bold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
						{isAuthenticated
							? `Welcome back, ${user?.name?.split(" ")[0]}`
							: "Welcome to Cline Desktop App"}
					</h2>
					<p className="mt-3 text-pretty text-sm leading-relaxed text-muted-foreground sm:text-base">
						Monitor and manage Cline agents from a single dashboard.
					</p>
				</div>

				{/* Product grid */}
				<div className="w-full max-w-2xl">
					<h3 className="mb-4 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
						Features
					</h3>
					<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
						{products.map((product) => (
							<ProductCard key={product.id} product={product} />
						))}
					</div>
				</div>
			</main>

			{/* Footer */}
			<footer className="border-t border-border px-4 py-4 text-center sm:px-6">
				<p className="text-[11px] text-muted-foreground">Cline</p>
			</footer>
		</div>
	);
}
