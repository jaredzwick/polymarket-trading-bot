import type { IMarketDataService } from "../services/market-data";
import type { IEventBus } from "../core/events";
import type { ILogger } from "../core/logger";
import type { Signal } from "./signal";

/**
 * Runtime context injected into every SignalAdapter by the AdapterRegistry
 * (Phase 2). Adapters MUST NOT hold long-lived references to this object
 * after shutdown() resolves.
 */
export interface AdapterContext {
  /** Read-only access to live order-book and market data. */
  marketData: IMarketDataService;
  /**
   * Shared event bus. Adapters emit signals via:
   *   ctx.events.emit("signal_emitted", signal)
   */
  events: IEventBus;
  logger: ILogger;
  /**
   * Adapter-specific configuration blob. Adapters should validate
   * and cast this to their own config type inside initialize().
   */
  config: Record<string, unknown>;
}

/**
 * Contract every pluggable signal adapter must satisfy.
 *
 * Lifecycle:
 *   1. initialize(ctx) — one-time setup, load state, validate config.
 *   2. start(ctx)      — begin emitting Signal objects; returns when the
 *                        adapter has registered its polling/stream and is
 *                        ready (Phase 2 wires the loop).
 *   3. shutdown()      — flush buffers, cancel timers, release resources.
 *
 * Adapters are NOT allowed to call ctx.events.emit() before initialize()
 * resolves or after shutdown() resolves.
 */
export interface SignalAdapter {
  /** Stable machine-readable name. Must be globally unique in the registry. */
  readonly name: string;
  /** SemVer string — used for compatibility checks in Phase 2. */
  readonly version: string;

  initialize(ctx: AdapterContext): Promise<void>;

  /**
   * Begin signal production. Implementations typically set up an interval,
   * WebSocket, or async iterator here, and emit signals via ctx.events.
   *
   * Returns void or a teardown function that shutdown() may call.
   */
  start(ctx: AdapterContext): Promise<void>;

  /** Gracefully stop signal production and free all resources. */
  shutdown(): Promise<void>;
}

/**
 * A SignalAdapter that can be introspected for health and diagnostics.
 * Optional — adapters may implement this in addition to SignalAdapter.
 */
export interface HealthCheckAdapter extends SignalAdapter {
  /** Returns true if the adapter is currently healthy and producing signals. */
  isHealthy(): boolean;
  /** Adapter-specific diagnostic metrics. */
  diagnostics(): Record<string, unknown>;
}

/**
 * Descriptor registered in the AdapterRegistry (Phase 2 runtime).
 * Carries the factory function alongside config and metadata.
 */
export interface AdapterDescriptor {
  name: string;
  version: string;
  /** Factory creates a fresh adapter instance from a raw config blob. */
  factory: (config: Record<string, unknown>) => SignalAdapter;
  description?: string;
}
