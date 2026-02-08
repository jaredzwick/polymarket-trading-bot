# services

Core business logic — market data, order execution, and risk management.

## What it does

Three services that sit between the trading strategies and the Polymarket API:

## Files

- **market-data.ts** — `MarketDataService`. Polls orderbooks on a configurable interval (default 1s), caches them, and emits `orderbook_update` events when prices change. Subscribe/unsubscribe to token IDs.
- **order-manager.ts** — `OrderManager`. Submits orders (with risk checks first), cancels orders, tracks positions, calculates realized + unrealized PnL, and syncs local state with remote orders. Supports dry-run mode.
- **risk-manager.ts** — `RiskManager`. Enforces position size limits, total exposure limits, max open orders, and daily loss limits. Halts trading and emits `risk_breach` on violation.

## Data flow

```
MarketDataService → (orderbook events) → Strategies → (trade signals) → RiskManager → OrderManager → Client
```
