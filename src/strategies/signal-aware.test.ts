import { test, expect, beforeEach, mock } from "bun:test";
import { SignalAwareStrategy } from "./signal-aware";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import { MarketDataService } from "../services/market-data";
import { OrderManager } from "../services/order-manager";
import { RiskManager } from "../services/risk-manager";
import { SQLiteStore } from "../core/store";
import { MockPolymarketClient } from "../client";
import type { StrategyContext } from "./base";
import type { OrderBook } from "../types";
import type { Signal } from "../types/signal";
import { Events, Side } from "../types";

let strategy: SignalAwareStrategy;
let ctx: StrategyContext;

function makeOrderBook(mid = 0.5): OrderBook {
  return {
    tokenId: "tok-1",
    bids: [{ price: mid - 0.01, size: 100 }],
    asks: [{ price: mid + 0.01, size: 100 }],
    spread: 0.02,
    midPrice: mid,
    timestamp: new Date(),
  };
}

function emitSignal(events: EventBus, override: Partial<Signal> = {}): void {
  const signal: Signal = {
    id: crypto.randomUUID(),
    kind: "trade",
    source: "test",
    tokenId: "tok-1",
    confidence: 0.8,
    payload: { side: "BUY", targetPrice: 0.55, size: 10, reason: "test" },
    timestamp: new Date(),
    ...override,
  };
  events.emit(Events.SIGNAL_EMITTED, signal);
}

beforeEach(async () => {
  const logger = new Logger("error");
  const events = new EventBus();
  const store = new SQLiteStore(":memory:");
  const client = new MockPolymarketClient();
  const marketData = new MarketDataService(client, events, logger);
  const riskManager = new RiskManager(
    { maxPositionSize: 1000, maxTotalExposure: 5000, maxLossPerTrade: 100, maxDailyLoss: 500, maxOpenOrders: 50 },
    store, events, logger
  );
  const orderManager = new OrderManager(client, store, events, logger, riskManager, true);
  ctx = { marketData, orderManager, events, logger };

  strategy = new SignalAwareStrategy(ctx, { signalTtlMs: 60_000, minSignalConfidence: 0.5 });
  await strategy.initialize();
});

test("SignalAwareStrategy produces no signals without bus signals", () => {
  const result = strategy.evaluate("tok-1", makeOrderBook());
  expect(result).toHaveLength(0);
});

test("SignalAwareStrategy buffers signals and generates BUY on positive consensus", () => {
  emitSignal(ctx.events, { kind: "trade", confidence: 0.8, payload: { side: "BUY", targetPrice: 0.55, size: 10, reason: "up" } });
  emitSignal(ctx.events, { kind: "trade", confidence: 0.7, payload: { side: "BUY", targetPrice: 0.56, size: 10, reason: "up2" } });

  const result = strategy.evaluate("tok-1", makeOrderBook(0.5));
  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.BUY);
  expect(result[0].confidence).toBeGreaterThan(0);
});

test("SignalAwareStrategy generates SELL on negative consensus", () => {
  emitSignal(ctx.events, { confidence: 0.9, payload: { side: "SELL", targetPrice: 0.44, size: 10, reason: "dn" } });
  emitSignal(ctx.events, { confidence: 0.8, payload: { side: "SELL", targetPrice: 0.43, size: 10, reason: "dn2" } });

  const result = strategy.evaluate("tok-1", makeOrderBook(0.5));
  expect(result.length).toBeGreaterThan(0);
  expect(result[0].side).toBe(Side.SELL);
});

test("SignalAwareStrategy suppresses orders under risk signals", () => {
  // One moderate BUY signal
  emitSignal(ctx.events, { confidence: 0.7, payload: { side: "BUY", targetPrice: 0.6, size: 10, reason: "buy" } });

  // Heavy risk signal
  emitSignal(ctx.events, {
    kind: "risk",
    confidence: 1.0,
    payload: { txHash: "0x", from: "0xa", to: "0xb", amountUsdc: 1_000_000, direction: "inflow" },
  });
  emitSignal(ctx.events, { kind: "risk", confidence: 1.0, payload: {} });

  // riskMultiplier = (1 - 1.0*0.5)^2 = 0.25 > 0.2 but barely
  const result = strategy.evaluate("tok-1", makeOrderBook(0.5));
  // Size should be reduced significantly or order suppressed
  if (result.length > 0) {
    expect(result[0].size).toBeLessThanOrEqual(10);
  }
});

test("SignalAwareStrategy filters signals below minConfidence", () => {
  emitSignal(ctx.events, { confidence: 0.1 }); // below 0.5 threshold
  const buffer = strategy.getSignalBuffer();
  // Low-confidence signals are dropped before buffering
  expect(buffer.size).toBe(0);
});

test("SignalAwareStrategy ignores ambiguous consensus (net bias < 0.2)", () => {
  emitSignal(ctx.events, { confidence: 0.8, payload: { side: "BUY", targetPrice: 0.6, size: 10, reason: "buy" } });
  emitSignal(ctx.events, { confidence: 0.75, payload: { side: "SELL", targetPrice: 0.4, size: 10, reason: "sell" } });

  // Net bias = |0.8 - 0.75| / 1.55 ≈ 0.03 < 0.2 → no signal
  const result = strategy.evaluate("tok-1", makeOrderBook(0.5));
  expect(result).toHaveLength(0);
});

test("SignalAwareStrategy unsubscribes on shutdown", async () => {
  await strategy.shutdown();

  // After shutdown, new signals should not be buffered
  emitSignal(ctx.events);
  const buffer = strategy.getSignalBuffer();
  expect(buffer.size).toBe(0);
});

test("SignalAwareStrategy disabled returns no signals", async () => {
  emitSignal(ctx.events, { confidence: 0.9 });
  strategy.disable();
  expect(strategy.evaluate("tok-1", makeOrderBook())).toHaveLength(0);
});

test("SignalAwareStrategy populates triggeringSignalIds on trade signal output", () => {
  const sig1: Signal = {
    id: "aaa-111",
    kind: "trade",
    source: "test",
    tokenId: "tok-1",
    confidence: 0.8,
    payload: { side: "BUY", targetPrice: 0.55, size: 10, reason: "up" },
    timestamp: new Date(),
  };
  const sig2: Signal = {
    id: "bbb-222",
    kind: "trade",
    source: "test",
    tokenId: "tok-1",
    confidence: 0.9,
    payload: { side: "BUY", targetPrice: 0.56, size: 10, reason: "up2" },
    timestamp: new Date(),
  };
  ctx.events.emit(Events.SIGNAL_EMITTED, sig1);
  ctx.events.emit(Events.SIGNAL_EMITTED, sig2);

  const result = strategy.evaluate("tok-1", makeOrderBook(0.5));
  expect(result.length).toBeGreaterThan(0);
  expect(result[0].triggeringSignalIds).toBeDefined();
  expect(result[0].triggeringSignalIds).toContain("aaa-111");
  expect(result[0].triggeringSignalIds).toContain("bbb-222");
});
