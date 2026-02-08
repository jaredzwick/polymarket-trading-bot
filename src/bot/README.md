# bot

Trading bot orchestration and lifecycle management.

## What it does

Wires together the client, services, and strategies into a running trading bot. Handles startup, shutdown, strategy evaluation on market events, and trade execution.

## Files

- **engine.ts** — `TradingBot` class. Registers strategies, listens for orderbook updates, evaluates strategies, executes trade signals, and handles risk breaches (auto-cancels all orders). Provides status reporting with positions, PnL, and strategy metrics.
- **factory.ts** — `createBot()` and `loadConfigFromEnv()`. Builds a fully configured `TradingBot` from environment variables. Initializes the client (real or mock based on `DRY_RUN`), all services, and registers strategies.

## Usage

```ts
import { createBot, loadConfigFromEnv } from "./bot";

const config = loadConfigFromEnv();
const bot = await createBot(config);
await bot.start();
```

## Flow

```
Market event → evaluate strategies → collect signals → risk check → execute orders
```
