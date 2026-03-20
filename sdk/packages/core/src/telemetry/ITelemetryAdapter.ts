/**
 * Telemetry adapter interface for the @clinebot/core SDK.
 *
 * This is the SDK-side counterpart to the extension's ITelemetryProvider.
 * It is intentionally free of VS Code / host-provider dependencies so that
 * any consumer (CLI, tests, third-party integrations) can plug in their own
 * backend without pulling in the full extension runtime.
 */

// ---------------------------------------------------------------------------
// Property types
// ---------------------------------------------------------------------------

/** A JSON-serialisable primitive accepted as a telemetry attribute value. */
export type TelemetryPrimitive = string | number | boolean | null | undefined;

/** A JSON-serialisable value accepted as a telemetry property. */
export type TelemetryValue =
	| TelemetryPrimitive
	| TelemetryObject
	| TelemetryArray;

/** A JSON-serialisable object accepted as telemetry properties. */
export type TelemetryObject = { [key: string]: TelemetryValue };

/** A JSON-serialisable array accepted as telemetry properties. */
export type TelemetryArray = Array<TelemetryValue>;

/** Properties that can be safely passed to telemetry adapters. */
export type TelemetryProperties = TelemetryObject;

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

/**
 * Standard metadata that is merged into every telemetry event.
 * Mirrors {@link TelemetryMetadata} from the extension's TelemetryService so
 * that downstream consumers see the same schema.
 */
export interface TelemetryMetadata {
	/** Cline core / extension version (semver string). */
	extension_version: string;
	/**
	 * The distribution type: "vscode-extension" | "jetbrains-plugin" | "cli"
	 * etc.
	 */
	cline_type: string;
	/** Host IDE / environment name (e.g. "VSCode", "IntelliJ", "terminal"). */
	platform: string;
	/** Host environment version string. */
	platform_version: string;
	/** OS platform as returned by `os.platform()` (e.g. "darwin"). */
	os_type: string;
	/** OS version as returned by `os.version()`. */
	os_version: string;
	/** "true" when running in development mode, undefined otherwise. */
	is_dev?: string;
}

// ---------------------------------------------------------------------------
// Adapter interface
// ---------------------------------------------------------------------------

/**
 * Telemetry adapter that an SDK consumer implements (or uses via the
 * provided {@link OpenTelemetryAdapter}) to receive Cline telemetry events.
 *
 * The interface intentionally mirrors ITelemetryProvider from the extension
 * so that shared logic can be re-used or compared easily.
 */
export interface ITelemetryAdapter {
	/** Human-readable adapter name used for logging / diagnostics. */
	readonly name: string;

	/**
	 * Emit a standard telemetry event.
	 * Implementations may silently drop events when telemetry is disabled.
	 */
	emit(event: string, properties?: TelemetryProperties): void;

	/**
	 * Emit a *required* telemetry event that must not be suppressed by
	 * user opt-out settings (e.g. final opt-out confirmation events).
	 */
	emitRequired(event: string, properties?: TelemetryProperties): void;

	/**
	 * Record a monotonically-increasing counter metric.
	 * Implementations that do not support metrics may treat this as a no-op.
	 */
	recordCounter(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;

	/**
	 * Record a histogram (distribution) metric.
	 * Implementations that do not support metrics may treat this as a no-op.
	 */
	recordHistogram(
		name: string,
		value: number,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;

	/**
	 * Record a gauge (point-in-time) metric.
	 * Pass `null` as `value` to retire the series identified by
	 * `name + attributes` and prevent stale gauge entries.
	 * Implementations that do not support metrics may treat this as a no-op.
	 */
	recordGauge(
		name: string,
		value: number | null,
		attributes?: TelemetryProperties,
		description?: string,
		required?: boolean,
	): void;

	/** Returns whether the adapter is currently accepting events. */
	isEnabled(): boolean;

	/** Flush any buffered events/metrics to the backend. */
	flush(): Promise<void>;

	/** Release all resources held by the adapter. */
	dispose(): Promise<void>;
}
