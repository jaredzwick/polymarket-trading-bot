# Adapters

An **adapter** in this project is any external data source or signal provider that feeds into a trading strategy. The built-in strategies use Polymarket orderbook data directly, but you can wire in any external signal — news feeds, on-chain data, social sentiment, options flow, etc.

## Built-in adapters

| Adapter | File | Used by |
|---|---|---|
| Polymarket CLOB | `src/client/index.ts` | All strategies |
| Gamma API | `src/services/gamma.ts` | `bregman-arb` |

## Adding an external signal adapter

An adapter is a service that listens for external data and emits it onto the event bus. Here's the pattern:

```typescript
// src/services/my-adapter.ts
import type { EventBus } from "../core/events";
import type { Logger } from "../core/logger";
import { Events } from "../types";

export class MyAdapter {
  constructor(
    private events: EventBus,
    private logger: Logger,
    private config: { apiKey: string; pollIntervalMs: number }
  ) {}

  async start(): Promise<void> {
    this.logger.info("MyAdapter starting");
    setInterval(() => this.poll(), this.config.pollIntervalMs);
  }

  private async poll(): Promise<void> {
    try {
      // Fetch your external data here
      const signal = await fetchExternalSignal(this.config.apiKey);

      // Emit a custom event that your strategy listens for
      this.events.emit("MY_SIGNAL", { tokenId: signal.tokenId, score: signal.score });
    } catch (err) {
      this.logger.error("MyAdapter poll failed", { err });
    }
  }

  async stop(): Promise<void> {
    // cleanup
  }
}
```

Then in your strategy, consume it:

```typescript
export class MyStrategy extends BaseStrategy {
  readonly name = "my-strategy";
  private latestScore: Map<string, number> = new Map();

  constructor(ctx: StrategyContext) {
    super(ctx);
    ctx.events.on("MY_SIGNAL", ({ tokenId, score }) => {
      this.latestScore.set(tokenId, score);
    });
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal | null {
    const score = this.latestScore.get(tokenId) ?? 0;
    if (score < 0.7) return null;
    return { tokenId, side: "BUY", confidence: score, targetPrice: orderBook.midPrice, size: 10, reason: "external signal" };
  }
}
```

Wire it up in `src/bot/factory.ts`:

```typescript
// In createBot(), before the strategy loop:
const myAdapter = new MyAdapter(events, logger, { apiKey: process.env.MY_API_KEY!, pollIntervalMs: 5000 });
await myAdapter.start();
```

## Quality bar for contributed adapters

- Must not make blocking calls inside `evaluate()` — use an internal state cache updated asynchronously
- Must handle network failures gracefully (log and continue, do not crash the engine)
- Must expose a `stop()` method for graceful shutdown
- Must not store credentials in code — use env vars
- Must include at least one unit test with a mocked HTTP call
- README entry in this file describing the adapter, its data source, and required env vars

## Registry

| Adapter | Author | Data source | Required env vars |
|---|---|---|---|
| Gamma API | built-in | `gamma-api.polymarket.com` | `GAMMA_TAGS`, `GAMMA_BASE_URL` (optional) |

_Open a PR to add your adapter to this table._
