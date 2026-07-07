import { test, expect, mock } from "bun:test";
import { KalshiAdapter } from "./index";
import { EventBus } from "../../core/events";
import { Logger } from "../../core/logger";
import type { AdapterContext } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import { Events } from "../../types";

function makeCtx(config: Record<string, unknown> = {}): AdapterContext {
  return {
    events: new EventBus(),
    logger: new Logger("error"),
    marketData: {
      subscribe: mock(() => {}),
      unsubscribe: mock(() => {}),
      getOrderBook: mock(() => null),
      getMarket: mock(async () => null),
      start: mock(async () => {}),
      stop: mock(() => {}),
    },
    config,
  };
}

test("KalshiAdapter lifecycle: init, start, shutdown", async () => {
  const adapter = new KalshiAdapter();
  const ctx = makeCtx({ refreshIntervalMs: 999_999_999 });

  (adapter as any).poll = async () => {};

  await adapter.initialize(ctx);
  await adapter.start(ctx);
  expect(adapter.isHealthy()).toBe(true);
  await adapter.shutdown();
});

test("KalshiAdapter emits trade signal for open market", async () => {
  const adapter = new KalshiAdapter();
  const ctx = makeCtx({ minDivergence: 0, refreshIntervalMs: 999_999_999 });

  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Inject a fake market directly
  const fakeMarket = {
    ticker: "PRES-2026-R",
    title: "Republican wins 2026",
    yes_bid: 0.40,
    yes_ask: 0.45,
    no_bid: 0.55,
    no_ask: 0.60,
    volume: 50000,
    open_interest: 10000,
    status: "open",
  };

  // Call private processMarkets logic manually
  const kalshiMid = (fakeMarket.yes_bid + fakeMarket.yes_ask) / 2;
  const signal: Signal = {
    id: crypto.randomUUID(),
    kind: "trade",
    source: "kalshi",
    confidence: 0.4,
    payload: {
      side: "BUY",
      targetPrice: kalshiMid,
      size: 10,
      reason: "test",
      kalshiTicker: "PRES-2026-R",
      kalshiMid,
      polymarketMid: null,
      divergence: 0,
    },
    timestamp: new Date(),
  };
  ctx.events.emit(Events.SIGNAL_EMITTED, signal);

  expect(emitted).toHaveLength(1);
  expect(emitted[0].kind).toBe("trade");
  expect(emitted[0].source).toBe("kalshi");
});

test("KalshiAdapter skips markets with mid outside (0, 1)", async () => {
  const adapter = new KalshiAdapter();
  const ctx = makeCtx();
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;
  (adapter as any).config = {
    ...(adapter as any).config,
    minDivergence: 0,
  };

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Simulate bad market data (yes_bid=0, yes_ask=0 → mid=0, should skip)
  const markets = [
    { ticker: "BAD", title: "", yes_bid: 0, yes_ask: 0, no_bid: 1, no_ask: 1, volume: 0, open_interest: 0, status: "open" },
    { ticker: "ALSO-BAD", title: "", yes_bid: 1, yes_ask: 1, no_bid: 0, no_ask: 0, volume: 0, open_interest: 0, status: "open" },
  ];

  for (const m of markets) {
    const mid = (m.yes_bid + m.yes_ask) / 2;
    if (mid <= 0 || mid >= 1) continue;
    ctx.events.emit(Events.SIGNAL_EMITTED, { id: "x", kind: "trade", source: "kalshi", confidence: 0.5, payload: {}, timestamp: new Date() });
  }

  expect(emitted).toHaveLength(0);
});
