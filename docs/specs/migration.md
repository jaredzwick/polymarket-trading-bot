# Migration Plan: Existing Strategies → Signal Bus

This document describes how the four existing strategies
(`market-maker`, `momentum`, `mean-reversion`, `bregman-arb`) will subscribe
to the Phase 2 signal bus without breaking their current behavior.

## Guiding Principles

1. **Zero breaking changes** — existing `evaluate()` paths stay intact.
   Signal-bus subscription is strictly additive.
2. **Opt-in per strategy** — each strategy can ignore the bus entirely until
   its maintainer is ready to integrate.
3. **Confidence gating** — strategies must apply their own confidence
   threshold before acting on bus signals. The bus itself does not filter.
4. **No new required dependencies** — strategies will not be required to
   hold an `AdapterContext`; they receive signals through the existing
   `IEventBus` they already have in `StrategyContext`.

## Subscription Pattern

Phase 2 will extend `BaseStrategy` with an optional `onSignal` hook:

```typescript
// base.ts (Phase 2 addition)
abstract class BaseStrategy implements IStrategy {
  protected subscribeSignals(
    kinds: SignalKind[],
    handler: (signal: Signal) => void,
    opts?: { minConfidence?: number; tokenFilter?: string[] }
  ): () => void {
    return this.ctx.events.on("signal_emitted", (event) => {
      const signal = event.data as Signal;
      if (!isSignal(signal)) return;
      if (!isSignalFresh(signal)) return;
      if (!kinds.includes(signal.kind)) return;
      if (opts?.minConfidence && signal.confidence < opts.minConfidence) return;
      if (opts?.tokenFilter && signal.tokenId && !opts.tokenFilter.includes(signal.tokenId)) return;
      handler(signal);
    });
  }
}
```

Strategies call `subscribeSignals` inside `initialize()` and store the returned
teardown function, which they call in `shutdown()`.

## Per-Strategy Migration Path

### market-maker

**Current behavior:** quotes around midPrice based on spread and inventory.

**Signal integration:** subscribe to `"sentiment"` and `"inference"` signals to
adjust `inventorySkew` or skip quoting on low-confidence periods.

```typescript
// Phase 2 addition inside MarketMakerStrategy.initialize()
this.teardowns.push(
  this.subscribeSignals(["sentiment", "inference"], (signal) => {
    if (!isSignalOfKind(signal, "sentiment")) return;
    const p = signal.payload as SentimentSignalPayload;
    // Widen spread threshold when sentiment is strongly directional
    this.signalBias = p.score;
  }, { minConfidence: 0.6 })
);
```

**Breaking risk:** none — existing `evaluate()` loop unchanged.

---

### momentum

**Current behavior:** buys/sells based on price change over a rolling window.

**Signal integration:** subscribe to `"trade"` signals from LLM distiller as
a second confirmation layer. Only enter when the LLM agrees with the price
momentum direction.

```typescript
this.teardowns.push(
  this.subscribeSignals(["trade"], (signal) => {
    if (signal.tokenId) {
      this.llmBias.set(signal.tokenId, signal.payload as TradeSignalPayload);
    }
  }, { minConfidence: 0.7 })
);
```

In `evaluate()`, cross-check `this.llmBias.get(tokenId)?.side` against the
computed momentum direction before emitting a `TradeSignal`.

**Breaking risk:** none — cross-check is additive; if no LLM signal exists,
behavior is identical to today.

---

### mean-reversion

**Current behavior:** trades against z-score deviation from rolling mean.

**Signal integration:** subscribe to `"risk"` signals to suppress mean-reversion
entries during high-risk periods (e.g. pre-resolution events detected by an
adapter).

```typescript
this.teardowns.push(
  this.subscribeSignals(["risk"], (signal) => {
    if (signal.tokenId) {
      this.suppressedTokens.add(signal.tokenId);
      // Clear suppression after signal expires
      if (signal.expiresAt) {
        setTimeout(() => this.suppressedTokens.delete(signal.tokenId!),
          signal.expiresAt.getTime() - Date.now());
      }
    }
  })
);
```

**Breaking risk:** none — suppression is additive.

---

### bregman-arb

**Current behavior:** detects arbitrage via KL-divergence across market groups.

**Signal integration:** subscribe to `"inference"` signals to pre-filter
evaluation — skip groups where the LLM predicts the current price imbalance
is _intentional_ (e.g. a near-resolved market with known outcome), avoiding
arb attempts that will lose to adverse selection.

```typescript
this.teardowns.push(
  this.subscribeSignals(["inference"], (signal) => {
    if (signal.conditionId) {
      this.llmConditionNotes.set(signal.conditionId, signal);
    }
  }, { minConfidence: 0.75 })
);
```

Inside `checkBregmanArb`, skip if `llmConditionNotes.get(group.conditionId)`
indicates `suggestedSide === "HOLD"`.

**Breaking risk:** none — skip is additive.

---

## Rollout Sequence

| Phase | Work |
|-------|------|
| Phase 1 (this PR) | Type definitions, specs, guards. Zero runtime changes. |
| Phase 2 | `AdapterRegistry`, `LLMDistillerAdapter`, `subscribeSignals` on `BaseStrategy`, `Events.SIGNAL_EMITTED` wiring. |
| Phase 3 | Each strategy opts in by calling `subscribeSignals` in its `initialize()`. Behind a feature flag (`BotConfig.signalBus.enabled`). |
| Phase 4 | Remove feature flag, mark bus as stable API. |

## Config Additions (Phase 2)

`BotConfig` will gain an optional `adapters` field:

```typescript
interface BotConfig {
  // … existing fields …
  adapters?: {
    [adapterName: string]: {
      enabled: boolean;
      config: Record<string, unknown>;
    };
  };
  signalBus?: {
    enabled: boolean;
  };
}
```

Existing configs that do not set `adapters` or `signalBus` are unaffected.

## Testing Strategy

Each strategy integration will be covered by:
1. Unit test asserting that the strategy emits the same `TradeSignal` with no
   bus signals present (regression guard).
2. Unit test with a mocked bus signal verifying the expected augmented behavior.
