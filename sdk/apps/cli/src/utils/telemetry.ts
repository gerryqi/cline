import { createConfiguredTelemetryService } from "@clinebot/core/telemetry/opentelemetry";
import {
	createClineTelemetryServiceConfig,
	type ITelemetryService,
} from "@clinebot/shared";
import { getCliBuildInfo } from "./common";

let telemetrySingleton:
	| {
			telemetry: ITelemetryService;
			dispose: () => Promise<void>;
	  }
	| undefined;

export function getCliTelemetryService(): ITelemetryService {
	if (!telemetrySingleton) {
		const { version, name, os_type, os_version } = getCliBuildInfo();
		const config = createClineTelemetryServiceConfig({
			metadata: {
				extension_version: version,
				cline_type: name,
				platform: "terminal",
				platform_version: process.version,
				os_type,
				os_version,
			},
		});
		const { telemetry, provider } = createConfiguredTelemetryService(config);
		telemetrySingleton = {
			telemetry,
			dispose: async () => {
				await Promise.allSettled([telemetry.dispose(), provider?.dispose()]);
			},
		};
	}
	return telemetrySingleton.telemetry;
}

export async function disposeCliTelemetryService(): Promise<void> {
	if (!telemetrySingleton) {
		return;
	}
	const current = telemetrySingleton;
	telemetrySingleton = undefined;
	await current.dispose();
}
