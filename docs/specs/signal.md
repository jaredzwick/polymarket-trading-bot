# Signal Type

The `Signal<TPayload>` type is the canonical unit of communication on the
Polymarket trading bot's signal bus. Every pluggable `SignalAdapter` emits
`Signal` objects; every strategy that opts into signal-driven logic consumes
them.

## Shape

```typescript
interface Signal<TPayload = unknown> {
  id: string;           // Unique ID — adapters must use crypto.randomUUID()
  kind: SignalKind;     // One of: trade | news | sentiment | inference | risk | custom
  source: string;       // Stable adapter name (e.g. "llm-distiller")
  tokenId?: string;     // Token the signal concerns, if applicable
  conditionId?: string; // Market condition ID, if applicable
  confidence: number;   // 0–1 (0 = no confidence, 1 = certain)
  payload: TPayload;    // Kind-specific typed payload
  timestamp: Date;      // Wall-clock time when the signal was created
  expiresAt?: Date;     // If set, consumers must ignore the signal after this time
  metadata?: Record<string, unknown>; // Annotations — not trading-critical
}
```

## SignalKind

| Kind        | Meaning                                              |
|-------------|------------------------------------------------------|
| `trade`     | Directional buy/sell recommendation for a token      |
| `news`      | External news or information event                   |
| `sentiment` | Aggregated market sentiment score                    |
| `inference` | Raw LLM distiller output                             |
| `risk`      | Risk-level alert for a token or condition            |
| `custom`    | Adapter-specific extension — consumers should check `source` |

## Well-known Payload Types

The framework ships typed payload interfaces for common signal kinds:

| Kind          | Payload type               |
|---------------|----------------------------|
| `trade`       | `TradeSignalPayload`       |
| `sentiment`   | `SentimentSignalPayload`   |
| `inference`   | `InferenceSignalPayload`   |

Custom adapters may define their own payload types and export them alongside
their adapter implementation.

## Event Bus Wiring

Adapters emit signals onto the shared `EventBus` using the `signal_emitted`
event type (added to `EventType` in this PR). Strategies subscribe via:

```typescript
ctx.events.on("signal_emitted", (event) => {
  const signal = event.data as Signal;
  if (!isSignal(signal)) return;          // guard — never trust raw bus data
  if (!isSignalFresh(signal)) return;     // drop expired signals
  // …act on signal
});
```

Phase 2 will introduce a typed `SignalBus` wrapper that removes the need for
manual casting.

## Type Guards

`isSignal(value)` validates any unknown value against the Signal contract.
`isSignalFresh(signal, atTime?)` checks whether the signal has expired.
`isSignalOfKind(signal, kind)` narrows the `kind` discriminant.

All guards are exported from `src/types/guards.ts` and re-exported from
`src/types/index.ts`.

## Confidence Semantics

- `0.0` — no directional edge; adapter is uncertain. Do not trade on this.
- `0.0–0.5` — weak signal; use as supporting context only.
- `0.5–0.8` — moderate signal; suitable for reduced-size entry.
- `0.8–1.0` — strong signal; suitable for full-size entry.

Strategies define their own confidence threshold; the framework has no
built-in filter, but `LLMDistillerConfig.minConfidence` pre-filters at the
source.
