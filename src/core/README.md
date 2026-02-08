# core

Foundational infrastructure shared across the entire bot.

## What it does

Provides the event bus, logging, and data persistence that every other module depends on.

## Files

- **events.ts** — `EventBus` pub/sub system. Components communicate through typed events (`orderbook_update`, `risk_breach`, etc.) instead of direct coupling.
- **logger.ts** — `Logger` with structured output, log levels (debug/info/warn/error), child loggers for context, and ISO timestamps.
- **store.ts** — `SQLiteStore` using `bun:sqlite`. Persists positions, trades, and orders. Calculates daily PnL. Supports in-memory mode for tests.

## Usage

```ts
const bus = new EventBus();
bus.on("orderbook_update", (data) => { /* react */ });

const log = new Logger("MyModule", "info");
log.info("something happened", { detail: 42 });

const store = new SQLiteStore("./data.db"); // or ":memory:" for tests
store.savePosition(position);
```
