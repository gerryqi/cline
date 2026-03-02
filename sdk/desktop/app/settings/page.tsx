"use client";

import { Bell, Bot, ChevronLeft, LogOut, Sliders, User } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

const settingsSections = [
	{
		id: "account",
		label: "Account",
		description: "Manage your account settings, email, and password.",
		icon: User,
	},
	{
		id: "notifications",
		label: "Notifications",
		description: "Configure how you receive alerts and updates.",
		icon: Bell,
	},
	{
		id: "preferences",
		label: "Preferences",
		description: "Customize your workspace, theme, and display options.",
		icon: Sliders,
	},
];

export default function SettingsPage() {
	const { user, isAuthenticated, signOut } = useAuth();
	const router = useRouter();

	function handleSignOut() {
		signOut();
		router.push("/");
	}

	if (!isAuthenticated || !user) {
		return (
			<div className="flex min-h-[100dvh] flex-col items-center justify-center gap-4">
				<p className="text-sm text-muted-foreground">
					You need to sign in to access settings.
				</p>
				<Button asChild size="sm" variant="outline">
					<Link href="/">Go to Home</Link>
				</Button>
			</div>
		);
	}

	return (
		<div className="flex min-h-[100dvh] flex-col">
			{/* Header */}
			<header className="flex items-center justify-between border-b border-border px-4 py-3 sm:px-6">
				<div className="flex items-center gap-3">
					<Link
						aria-label="Back to home"
						className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:h-9 sm:w-9"
						href="/"
					>
						<ChevronLeft className="h-4 w-4" />
					</Link>
					<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 sm:h-9 sm:w-9">
						<Bot className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
					</div>
					<div>
						<h1 className="text-base font-semibold text-foreground sm:text-lg">
							Settings
						</h1>
						<p className="text-[10px] text-muted-foreground sm:text-xs">
							Manage your account
						</p>
					</div>
				</div>
			</header>

			{/* Content */}
			<main className="flex flex-1 flex-col items-center px-4 py-8 sm:px-6 sm:py-12">
				<div className="w-full max-w-lg">
					{/* Profile card */}
					<div className="mb-8 flex flex-col items-center gap-4 rounded-xl border border-border bg-card p-6 sm:flex-row sm:items-start">
						<Avatar className="h-16 w-16 ring-2 ring-border">
							<AvatarFallback className="bg-primary/15 text-lg font-semibold text-primary">
								{user.initials}
							</AvatarFallback>
						</Avatar>
						<div className="flex flex-col items-center gap-1 sm:items-start">
							<h2 className="text-base font-semibold text-foreground">
								{user.name}
							</h2>
							<p className="text-xs text-muted-foreground">{user.email}</p>
							<span className="mt-1 inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
								<span className="h-1.5 w-1.5 rounded-full bg-success" />
								Active
							</span>
						</div>
					</div>

					{/* Settings sections */}
					<div className="mb-8 flex flex-col gap-3">
						{settingsSections.map((section) => (
							<div
								className="flex items-start gap-4 rounded-xl border border-border bg-card p-4"
								key={section.id}
							>
								<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
									<section.icon className="h-4 w-4 text-muted-foreground" />
								</div>
								<div className="flex flex-col gap-1">
									<h3 className="text-sm font-medium text-foreground">
										{section.label}
									</h3>
									<p className="text-xs leading-relaxed text-muted-foreground">
										{section.description}
									</p>
									<span className="mt-1 text-[10px] font-medium text-muted-foreground/60">
										Coming soon
									</span>
								</div>
							</div>
						))}
					</div>

					{/* Sign out */}
					<Button
						className="w-full border-destructive/30 text-destructive hover:bg-destructive/10 hover:text-destructive"
						onClick={handleSignOut}
						size="sm"
						variant="outline"
					>
						<LogOut className="h-3.5 w-3.5" />
						Sign Out
					</Button>
				</div>
			</main>
		</div>
	);
}
