import type { Metadata, Viewport } from "next";

import "./globals.css";
import { AuthProvider } from "@/lib/auth-context";

export const metadata: Metadata = {
	title: "Cline Agents Tracker",
	description:
		"Track and monitor all coding agents running on your machine in real time.",
};

export const viewport: Viewport = {
	themeColor: "#0a0a0f",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="en">
			<body className="font-sans antialiased">
				<AuthProvider>{children}</AuthProvider>
			</body>
		</html>
	);
}
