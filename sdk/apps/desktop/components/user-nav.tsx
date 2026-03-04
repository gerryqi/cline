"use client";

import Link from "next/link";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

interface UserNavProps {
	className?: string;
	size?: "sm" | "default";
}

export function UserNav({ className, size = "default" }: UserNavProps) {
	const { user, isAuthenticated } = useAuth();

	if (!isAuthenticated || !user) return null;

	return (
		<Link
			aria-label="Go to settings"
			className={cn(
				"group flex items-center gap-2 rounded-full transition-opacity hover:opacity-80",
				className,
			)}
			href="/settings"
		>
			<Avatar
				className={cn(
					"ring-2 ring-border transition-all group-hover:ring-primary/50",
					size === "sm" ? "h-7 w-7" : "h-8 w-8",
				)}
			>
				<AvatarFallback
					className={cn(
						"bg-primary/15 font-medium text-primary",
						size === "sm" ? "text-[10px]" : "text-xs",
					)}
				>
					{user.initials}
				</AvatarFallback>
			</Avatar>
		</Link>
	);
}
