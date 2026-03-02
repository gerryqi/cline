"use client";

import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";

export interface User {
	name: string;
	email: string;
	initials: string;
}

interface AuthContextType {
	user: User | null;
	isAuthenticated: boolean;
	signIn: (email: string, password: string) => void;
	signOut: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function getInitials(email: string): string {
	const local = email.split("@")[0];
	if (!local) return "U";
	const parts = local.split(/[._-]/);
	if (parts.length >= 2) {
		return (parts[0][0] + parts[1][0]).toUpperCase();
	}
	return local.slice(0, 2).toUpperCase();
}

function getDisplayName(email: string): string {
	const local = email.split("@")[0];
	if (!local) return "User";
	return local
		.split(/[._-]/)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(" ");
}

export function AuthProvider({ children }: { children: ReactNode }) {
	const [user, setUser] = useState<User | null>(null);
	const [mounted, setMounted] = useState(false);

	useEffect(() => {
		setMounted(true);
		try {
			const stored = localStorage.getItem("agentboard-user");
			if (stored) {
				setUser(JSON.parse(stored));
			}
		} catch {
			// ignore
		}
	}, []);

	const signIn = useCallback((email: string, _password: string) => {
		const newUser: User = {
			name: getDisplayName(email),
			email,
			initials: getInitials(email),
		};
		setUser(newUser);
		try {
			localStorage.setItem("agentboard-user", JSON.stringify(newUser));
		} catch {
			// ignore
		}
	}, []);

	const signOut = useCallback(() => {
		setUser(null);
		try {
			localStorage.removeItem("agentboard-user");
		} catch {
			// ignore
		}
	}, []);

	if (!mounted) {
		return (
			<AuthContext.Provider
				value={{ user: null, isAuthenticated: false, signIn, signOut }}
			>
				{children}
			</AuthContext.Provider>
		);
	}

	return (
		<AuthContext.Provider
			value={{ user, isAuthenticated: !!user, signIn, signOut }}
		>
			{children}
		</AuthContext.Provider>
	);
}

export function useAuth() {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
}
