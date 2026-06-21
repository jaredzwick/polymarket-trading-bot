# Contributing

Thanks for your interest in contributing! The fastest way to help is adding a new strategy — they're self-contained and immediately useful to other traders.

## Ways to contribute

- **New strategy** — a new `evaluate()` implementation (see below)
- **Bug fix** — open an issue first if the fix is non-trivial
- **Documentation** — typos, missing examples, clarity improvements

## Adding a strategy (~30 lines)

**1. Create the strategy file**

```bash
touch src/strategies/my-strategy.ts
```

```typescript
import { BaseStrategy, type StrategyContext } from "./base";
import type { TradeSignal, OrderBook } from "../types";

interface MyStrategyConfig {
  threshold: number;
  orderSize: number;
}

export class MyStrategy extends BaseStrategy {
  readonly name = "my-strategy";
  private config: MyStrategyConfig;

  constructor(ctx: StrategyContext, config: Partial<MyStrategyConfig> = {}) {
    super(ctx);
    this.config = { threshold: 0.05, orderSize: 10, ...config };
  }

  evaluate(tokenId: string, orderBook: OrderBook): TradeSignal | null {
    if (!this._enabled) return null;

    const { midPrice, spread } = orderBook;

    if (spread < this.config.threshold) return null;

    return {
      tokenId,
      side: "BUY",
      confidence: 0.7, // must be > 0.5 to execute
      targetPrice: midPrice,
      size: this.config.orderSize,
      reason: "spread exceeded threshold",
    };
  }
}
```

**2. Export it**

```typescript
// src/strategies/index.ts
export { MyStrategy } from "./my-strategy";
```

**3. Register it in the factory**

```typescript
// src/bot/factory.ts — inside the strategy switch:
case "my-strategy":
  bot.registerStrategy(new MyStrategy(strategyCtx));
  break;
```

**4. Write a test**

```bash
touch src/strategies/my-strategy.test.ts
bun test src/strategies/my-strategy.test.ts
```

Look at `src/strategies/market-maker.test.ts` for the test pattern.

**5. Open a PR**

Use the PR template. Include a short description of the signal logic and test output.

## Quality bar

- `bun typecheck` must pass
- `bun test` must pass
- Strategy name must be kebab-case and unique
- `confidence` must be in range `(0, 1]` — values ≤ 0.5 are silently ignored by the engine
- No `process.exit()` or unhandled promise rejections in strategy code

## Setup

```bash
git clone https://github.com/jaredzwick/polymarket-trading-bot
cd polymarket-trading-bot
bun install
bun test
```

## Code style

- TypeScript strict mode — no `any` unless unavoidable
- Prefer `readonly` properties in strategy configs
- `BaseStrategy.ctx` gives you `marketData`, `orderManager`, `events`, and `logger` — use them instead of global state

## Questions

Open a [discussion](https://github.com/jaredzwick/polymarket-trading-bot/discussions) or file an issue.
