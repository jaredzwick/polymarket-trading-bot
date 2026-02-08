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
