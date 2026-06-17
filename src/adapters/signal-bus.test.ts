/**
 * End-to-end signal bus dry-run test.
 *
 * Seeds mock signals from a fake adapter through the registry and verifies
 * they reach a SignalAwareStrategy. No real HTTP calls are made.
 */
import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { AdapterRegistry } from "./registry";
import { SignalAwareStrategy } from "../strategies/signal-aware";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import { SQLiteStore } from "../core/store";
import { MarketDataService } from "../services/market-data";
import { OrderManager } from "../services/order-manager";
import { RiskManager } from "../services/risk-manager";
import { MockPolymarketClient } from "../client";
import type { AdapterContext, SignalAdapter, AdapterDescriptor } from "../types/adapter";
import type { Signal } from "../types/signal";
import type { OrderBook } from "../types";
import { Events, Side } from "../types";

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeOrderBook(mid = 0.5): OrderBook {
  return {
    tokenId: "e2e-token-1",
    bids: [{ price: mid - 0.01, size: 100 }],
    asks: [{ price: mid + 0.01, size: 100 }],
    spread: 0.02,
    midPrice: mid,
    timestamp: new Date(),
  };
}

/** Adapter that emits a fixed set of seeded signals immediately on start(). */
class SeedAdapter implements SignalAdapter {
  readonly name = "seed";
  readonly version = "1.0.0";

  constructor(private readonly seeds: Partial<Signal>[]) {}

  async initialize(_ctx: AdapterContext): Promise<void> {}

  async start(ctx: AdapterContext): Promise<void> {
    for (const seed of this.seeds) {
      const signal: Signal = {
        id: crypto.randomUUID(),
        kind: seed.kind ?? "trade",
        source: this.name,
        tokenId: seed.tokenId ?? "e2e-token-1",
        confidence: seed.confidence ?? 0.8,
        payload: seed.payload ?? { side: "BUY", targetPrice: 0.55, size: 10, reason: "seeded" },
        timestamp: new Date(),
        expiresAt: seed.expiresAt,
        metadata: seed.metadata,
        ...seed,
      };
      ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    }
  }

  async shutdown(): Promise<void> {}
}

const seedDescriptor = (seeds: Partial<Signal>[]): AdapterDescriptor => ({
  name: "seed",
  version: "1.0.0",
  description: "Test seeder adapter",
  factory: () => new SeedAdapter(seeds),
});

// ── Shared test infrastructure ─────────────────────────────────────────────

let registry: AdapterRegistry;
let strategy: SignalAwareStrategy;
let events: EventBus;

async function setup(seeds: Partial<Signal>[]) {
  const logger = new Logger("error");
  events = new EventBus();
  const store = new SQLiteStore(":memory:");
  const client = new MockPolymarketClient();
  const marketData = new MarketDataService(client, events, logger);
  const riskManager = new RiskManager(
    { maxPositionSize: 1000, maxTotalExposure: 5000, maxLossPerTrade: 100, maxDailyLoss: 500, maxOpenOrders: 50 },
    store, events, logger
  );
  const orderManager = new OrderManager(client, store, events, logger, riskManager, true);
  const ctx = { marketData, orderManager, events, logger };

  strategy = new SignalAwareStrategy(ctx, { minSignalConfidence: 0.5, signalTtlMs: 60_000 });
  await strategy.initialize();

  registry = new AdapterRegistry({ events, logger, marketData });
  registry.register(seedDescriptor(seeds));

  await registry.start();
}

async function teardown() {
  await registry.shutdown();
  await strategy.shutdown();
}

// ── Tests ──────────────────────────────────────────────────────────────────

test("E2E: seeded BUY signal flows through registry to strategy → BUY trade signal", async () => {
  await setup([
    { kind: "trade", confidence: 0.9, payload: { side: "BUY", targetPrice: 0.6, size: 10, reason: "seeded-buy" } },
    { kind: "trade", confidence: 0.8, payload: { side: "BUY", targetPrice: 0.62, size: 5, reason: "seeded-buy-2" } },
  ]);

  const result = strategy.evaluate("e2e-token-1", makeOrderBook(0.55));

  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.BUY);
  expect(result[0].confidence).toBeGreaterThan(0);

  await teardown();
});

test("E2E: seeded SELL signal flows through registry to strategy → SELL trade signal", async () => {
  await setup([
    { kind: "trade", confidence: 0.9, payload: { side: "SELL", targetPrice: 0.4, size: 10, reason: "seeded-sell" } },
  ]);

  const result = strategy.evaluate("e2e-token-1", makeOrderBook(0.5));

  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.SELL);

  await teardown();
});

test("E2E: seeded inference signal with BUY side produces BUY trade signal", async () => {
  await setup([
    {
      kind: "inference",
      confidence: 0.85,
      payload: {
        model: "claude-haiku-4-5-20251001",
        prompt: "test prompt",
        output: '{"tokenId":"e2e-token-1","confidence":0.85,"rationale":"bull","suggestedSide":"BUY","suggestedSize":20}',
        parsedConfidence: 0.85,
      },
      metadata: { suggestedSide: "BUY", suggestedSize: 20, rationale: "bullish" },
    },
  ]);

  const result = strategy.evaluate("e2e-token-1", makeOrderBook(0.5));

  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.BUY);

  await teardown();
});

test("E2E: risk signal suppresses ordering when riskMultiplier drops below 0.2", async () => {
  await setup([
    { kind: "trade", confidence: 0.8, payload: { side: "BUY", targetPrice: 0.6, size: 10, reason: "buy" } },
    // Four maxed-out risk signals → riskMultiplier = (0.5)^4 = 0.0625 < 0.2 → suppressed
    { kind: "risk", confidence: 1.0, payload: {} },
    { kind: "risk", confidence: 1.0, payload: {} },
    { kind: "risk", confidence: 1.0, payload: {} },
    { kind: "risk", confidence: 1.0, payload: {} },
  ]);

  const result = strategy.evaluate("e2e-token-1", makeOrderBook(0.5));
  expect(result).toHaveLength(0);

  await teardown();
});

test("E2E: low-confidence signals are filtered out before strategy sees them", async () => {
  await setup([
    { kind: "trade", confidence: 0.1, payload: { side: "BUY", targetPrice: 0.6, size: 10, reason: "weak" } },
    { kind: "trade", confidence: 0.2, payload: { side: "BUY", targetPrice: 0.61, size: 10, reason: "weak2" } },
  ]);

  const result = strategy.evaluate("e2e-token-1", makeOrderBook(0.5));
  // Low-confidence signals filtered → no signals → no trade
  expect(result).toHaveLength(0);

  await teardown();
});

test("E2E: global signals (no tokenId) affect all token evaluations", async () => {
  await setup([
    {
      kind: "trade",
      confidence: 0.9,
      tokenId: undefined, // global signal
      payload: { side: "BUY", targetPrice: 0.7, size: 10, reason: "global-bull" },
    },
  ]);

  // Should affect any tokenId evaluation
  const result = strategy.evaluate("any-other-token", makeOrderBook(0.6));
  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.BUY);

  await teardown();
});

test("E2E: registry shutdown prevents further signal emission", async () => {
  await setup([]);

  const emitted: Signal[] = [];
  events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  await registry.shutdown();

  // After shutdown, adapter cannot emit (it's stopped)
  expect(registry.listRunning()).toHaveLength(0);
  expect(registry.isRunning()).toBe(false);

  await strategy.shutdown();
});
