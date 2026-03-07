import type { AgentMode } from "@cline/shared";
import { Box, Text } from "ink";
import React, { memo } from "react";

interface WelcomeViewProps {
	providerId: string;
	modelId: string;
	mode: AgentMode;
	mouseOffsetX: number;
	mouseOffsetY: number;
}

const CLINE_LOGO = [
	"            :::::::            ",
	"           :::::::::           ",
	"       :::::::::::::::::       ",
	"    :::::::::::::::::::::::    ",
	"   :::::::::::::::::::::::::   ",
	"  :::::::::::::::::::::::::::  ",
	"  :::::::   :::::::   :::::::  ",
	" :::::::     :::::     ::::::: ",
	"::::::::     :::::     ::::::::",
	"::::::::     :::::     ::::::::",
	" :::::::     :::::     ::::::: ",
	"  :::::::   :::::::   :::::::  ",
	"  :::::::::::::::::::::::::::  ",
	"   :::::::::::::::::::::::::   ",
	"    :::::::::::::::::::::::    ",
	"       ::::::::::::::::        ",
] as const;

function WelcomeViewComponent(props: WelcomeViewProps): React.ReactElement {
	const horizontalShift = Math.max(-4, Math.min(4, props.mouseOffsetX));
	const verticalPadding = Math.max(0, Math.min(2, props.mouseOffsetY + 1));
	const shiftedLogo = CLINE_LOGO.map((line) => {
		if (horizontalShift === 0) {
			return line;
		}
		if (horizontalShift > 0) {
			return `${" ".repeat(horizontalShift)}${line}`;
		}
		return line.slice(Math.abs(horizontalShift));
	});

	return React.createElement(
		Box,
		{ flexDirection: "column", alignItems: "center", marginBottom: 1 },
		...Array.from({ length: verticalPadding }, (_, index) =>
			React.createElement(Text, { key: `top-pad:${index}` }, " "),
		),
		React.createElement(
			Box,
			{ flexDirection: "column", marginBottom: 1 },
			shiftedLogo.map((line, index) =>
				React.createElement(
					Text,
					{ color: "white", key: `${index}:${line}` },
					line,
				),
			),
		),
		React.createElement(
			Box,
			{ marginBottom: 1 },
			React.createElement(
				Text,
				{ bold: true, color: "white" },
				"What can I do for you?",
			),
		),
	);
}

export const WelcomeView = memo(WelcomeViewComponent);
