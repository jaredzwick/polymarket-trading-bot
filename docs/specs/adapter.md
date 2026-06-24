# SignalAdapter Contract

A `SignalAdapter` is a pluggable signal source. Adapters connect external data
streams (LLMs, news feeds, on-chain oracles, etc.) to the bot's internal signal
bus, translating raw data into typed `Signal` objects that strategies consume.

## Interface

```typescript
interface SignalAdapter {
  readonly name: string;    // Stable, globally-unique machine identifier
  readonly version: string; // SemVer string
  initialize(ctx: AdapterContext): Promise<void>;
  start(ctx: AdapterContext): Promise<void>;
  shutdown(): Promise<void>;
}
```

### Lifecycle

```
            ┌──────────────┐
            │  registered  │  (AdapterRegistry.register)
            └──────┬───────┘
                   │
            initialize(ctx)   ← validate config, open connections
                   │
            ┌──────▼───────┐
            │  initialized │
            └──────┬───────┘
                   │
              start(ctx)       ← begin polling / streaming signals
                   │
            ┌──────▼───────┐
            │    running   │  ← emitting Signal objects via ctx.events
            └──────┬───────┘
                   │
              shutdown()       ← flush, cancel timers, close connections
                   │
            ┌──────▼───────┐
            │   stopped    │
            └──────────────┘
```

Rules:
- Adapters **must not** emit signals before `initialize()` resolves.
- Adapters **must not** emit signals after `shutdown()` resolves.
- `shutdown()` must be idempotent — safe to call multiple times.
- Adapters **must not** throw from `start()` for recoverable errors;
  log and continue instead.

## AdapterContext

The context object injected on `initialize` and `start`:

```typescript
interface AdapterContext {
  marketData: IMarketDataService; // Read-only order-book and market lookup
  events: IEventBus;              // Emit signals via events.emit("signal_emitted", signal)
  logger: ILogger;                // Structured logger pre-configured with adapter name
  config: Record<string, unknown>; // Validated config blob for this adapter instance
}
```

## Emitting a Signal

Inside `start()`, adapters emit signals like this:

```typescript
import { Events } from "../../types";

const signal: Signal<TradeSignalPayload> = {
  id: crypto.randomUUID(),
  kind: "trade",
  source: this.name,
  tokenId: "0xabc…",
  confidence: 0.75,
  payload: { side: "BUY", targetPrice: 0.62, size: 10, reason: "LLM bullish" },
  timestamp: new Date(),
  expiresAt: new Date(Date.now() + 30_000),
};
ctx.events.emit(Events.SIGNAL_EMITTED, signal);
```

## Optional: HealthCheckAdapter

Adapters may additionally implement `HealthCheckAdapter`:

```typescript
interface HealthCheckAdapter extends SignalAdapter {
  isHealthy(): boolean;
  diagnostics(): Record<string, unknown>;
}
```

The `AdapterRegistry` (Phase 2) will surface health status in the dashboard.

## AdapterDescriptor

Adapters are registered by descriptor, not by instance:

```typescript
interface AdapterDescriptor {
  name: string;
  version: string;
  factory: (config: Record<string, unknown>) => SignalAdapter;
  description?: string;
}
```

The factory is called once per adapter instance. The registry injects config
from `BotConfig.adapters[name]` (Phase 2).

## Type Guards

`isSignalAdapter(value)` validates any unknown value conforms to the interface.
`isAdapterContext(value)` validates the shape of a context object.

Both are exported from `src/types/guards.ts`.

## Naming Conventions

- `name` must be kebab-case (e.g. `"llm-distiller"`, `"news-feed"`).
- `version` must be SemVer (e.g. `"1.0.0"`).
- Source IDs in `Signal.source` must exactly match `adapter.name`.
