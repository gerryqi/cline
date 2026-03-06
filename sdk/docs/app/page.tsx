"use client";

import { useState } from "react";
import { LifecycleVisualizer } from "@/components/lifecycle/lifecycle-visualizer";
import { WelcomePage } from "@/components/welcome-page";

export default function Page() {
	const [view, setView] = useState<"welcome" | "visualizer">("welcome");

	if (view === "visualizer") {
		return <LifecycleVisualizer onBack={() => setView("welcome")} />;
	}

	return <WelcomePage onNavigateToVisualizer={() => setView("visualizer")} />;
}
