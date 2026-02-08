# Polymarket Trading Bot

Automated trading bot for [Polymarket](https://polymarket.com) prediction markets. Supports multiple strategies, risk management, and dry-run mode.

## Quick Start

```bash
bun install
cp .env.example .env  # configure your keys
bun run dev            # starts in dry-run mode with hot reload
```

## Strategies

| Strategy | Approach |
|---|---|
| **Market Maker** | Places orders on both sides of the book to capture spread |
| **Momentum** | Follows price trends over a rolling window |
| **Mean Reversion** | Trades against extreme price moves using z-scores |

## Architecture

```
src/
  bot/         → Bot engine & factory — wires everything together
  client/      → Polymarket API client (real + mock for dry-run)
  core/        → Event bus, logger, SQLite persistence
  services/    → Market data polling, order execution, risk management
  strategies/  → Strategy implementations (market-maker, momentum, mean-reversion)
  types/       → Shared TypeScript types
```

```
Market Data → Event Bus → Strategies → Risk Check → Order Execution → Polymarket
```

## Configuration

Set via environment variables:

| Variable | Description |
|---|---|
| `PRIVATE_KEY` | Wallet private key |
| `POLYMARKET_API_KEY` | API key |
| `POLYMARKET_API_SECRET` | API secret |
| `POLYMARKET_API_PASSPHRASE` | API passphrase |
| `DRY_RUN` | `true` (default) — simulate trades without real money |
| `STRATEGIES` | Comma-separated: `market-maker,momentum,mean-reversion` |
| `TOKEN_IDS` | Comma-separated token IDs to trade |
| `MAX_POSITION_SIZE` | Max size per position |
| `MAX_TOTAL_EXPOSURE` | Max total exposure across all positions |
| `MAX_DAILY_LOSS` | Daily loss limit (halts trading on breach) |

## Scripts

```bash
bun run start      # run the bot
bun run dev        # run with hot reload
bun test           # run tests
bun run typecheck  # check types
```

## Safety

- Starts in dry-run mode by default — no real orders
- Risk manager enforces position limits, exposure caps, and daily loss limits
- Graceful shutdown cancels all open orders on SIGINT/SIGTERM
- All trades persisted to SQLite for audit

# How to use with your own strategy
 1. Create your strategy file

Create src/strategies/my-strategy.ts:

```typescript
  import { BaseStrategy, type StrategyContext } from "./base";
  import type { TradeSignal, OrderBook } from "../types";
  import { Side } from "../types";

  interface MyStrategyConfig {
    orderSize: number;
    threshold: number;
  }

  export class MyStrategy extends BaseStrategy {
    readonly name = "my-strategy";
    private config: MyStrategyConfig;

    constructor(ctx: StrategyContext, config: Partial<MyStrategyConfig> = {}) {
      super(ctx);
      this.config = { orderSize: 10, threshold: 0.05, ...config };
    }

    evaluate(tokenId: string, orderBook: OrderBook): TradeSignal | null {
      if (!this._enabled) return null;

      const { midPrice, spread, bids, asks } = orderBook;

      // --- YOUR LOGIC HERE ---
      // Check current position:
      const position = this.ctx.orderManager.getPosition(tokenId);

      // Return null = no trade. 
      if (spread < this.config.threshold) return null;

      // Return a signal = place an order.
      return {
        tokenId,
        side: Side.BUY,
        confidence: 0.7,        // must be > 0.5 to execute
        targetPrice: midPrice,
        size: this.config.orderSize,
        reason: "spread exceeded threshold",
      };
    }

    onOrderFilled(orderId: string, tokenId: string, price: number, size: number) {
      super.onOrderFilled(orderId, tokenId, price, size);
      // Track fills, update internal state, call this.recordPnl(amount)
    }
  }
```

  2. Register it

  src/strategies/index.ts — add the export:
```typescript
  export { MyStrategy } from "./my-strategy";

  src/bot/factory.ts — add a case in the strategy switch:
  case "my-strategy":
    bot.registerStrategy(new MyStrategy(strategyCtx));
    break;
```

  3. Run it

  # Dry-run mode (no real orders, safe to test)
  `DRY_RUN=true STRATEGIES=my-strategy TOKEN_IDS=<token_id> bun run src/main.ts`
  - Return null when you have no signal — don't force trades
  - confidence must be > 0.5 or the engine ignores the signal
  - Check position limits before returning large sizes
  - The risk manager will block orders that exceed limits (maxPositionSize, maxDailyLoss, etc.) set in your .env