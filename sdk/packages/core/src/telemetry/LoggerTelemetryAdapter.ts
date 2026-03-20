import type { BasicLogger } from "@clinebot/shared";
import type {
	ITelemetryAdapter,
	TelemetryProperties,
} from "./ITelemetryAdapter";

export interface LoggerTelemetryAdapterOptions {
	logger?: BasicLogger;
	name?: string;
	enabled?: boolean | (() => boolean);
}

export class LoggerTelemetryAdapter implements ITelemetryAdapter {
	readonly name: string;

	private readonly logger?: BasicLogger;
	private readonly enabled: boolean | (() => boolean);

	constructor(options: LoggerTelemetryAdapterOptions = {}) {
		this.name = options.name ?? "LoggerTelemetryAdapter";
		this.logger = options.logger;
		this.enabled = options.enabled ?? true;
	}

	emit(event: string, properties?: TelemetryProperties): void {
		if (!this.isEnabled()) {
			return;
		}
		this.logger?.info?.("telemetry.event", {
			adapter: this.name,
			event,
			properties,
		});
	}

	emitRequired(event: string, properties?: TelemetryProperties): void {
		this.logger?.warn?.("telemetry.required_event", {
			adapter: this.name,
			event,
			properties,
		});
	}

	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug?.("telemetry.metric", {
			adapter: this.name,
			instrument: "counter",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug?.("telemetry.metric", {
			adapter: this.name,
			instrument: "histogram",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void {
		if (!required && !this.isEnabled()) {
			return;
		}
		this.logger?.debug?.("telemetry.metric", {
			adapter: this.name,
			instrument: "gauge",
			name,
			value,
			attributes,
			description,
			required: required === true,
		});
	}

	isEnabled(): boolean {
		return typeof this.enabled === "function" ? this.enabled() : this.enabled;
	}

	async flush(): Promise<void> {}

	async dispose(): Promise<void> {}
}
