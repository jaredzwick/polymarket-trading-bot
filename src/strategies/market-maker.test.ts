import { test, expect, beforeEach } from "bun:test";
import { MarketMakerStrategy } from "./market-maker";
import { EventBus } from "../core/events";
import { SQLiteStore } from "../core/store";
import { Logger } from "../core/logger";
import { MarketDataService } from "../services/market-data";
import { OrderManager } from "../services/order-manager";
import { RiskManager } from "../services/risk-manager";
import { MockPolymarketClient } from "../client";
import type { StrategyContext } from "./base";
import type { OrderBook } from "../types";
import { Side } from "../types";

let strategy: MarketMakerStrategy;
let ctx: StrategyContext;

beforeEach(() => {
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
  strategy = new MarketMakerStrategy(ctx, { spreadThreshold: 0.02 });
});

test("MarketMakerStrategy ignores narrow spreads", () => {
  const orderBook: OrderBook = {
    tokenId: "token-1",
    bids: [{ price: 0.50, size: 100 }],
    asks: [{ price: 0.51, size: 100 }],
    spread: 0.01, // Below threshold
    midPrice: 0.505,
    timestamp: new Date(),
  };

  const signal = strategy.evaluate("token-1", orderBook);
  expect(signal).toEqual([]);
});

test("MarketMakerStrategy generates signal for wide spread", () => {
  const orderBook: OrderBook = {
    tokenId: "token-1",
    bids: [{ price: 0.48, size: 100 }],
    asks: [{ price: 0.52, size: 100 }],
    spread: 0.04, // Above threshold
    midPrice: 0.50,
    timestamp: new Date(),
  };

  const signal = strategy.evaluate("token-1", orderBook);

  expect(signal.length).toBe(1);
  expect(signal[0].tokenId).toBe("token-1");
  expect(signal[0].confidence).toBeGreaterThan(0);
  expect(signal[0].reason).toContain("Spread capture");
});

test("MarketMakerStrategy respects enabled state", () => {
  strategy.disable();

  const orderBook: OrderBook = {
    tokenId: "token-1",
    bids: [{ price: 0.40, size: 100 }],
    asks: [{ price: 0.60, size: 100 }],
    spread: 0.20,
    midPrice: 0.50,
    timestamp: new Date(),
  };

  const signal = strategy.evaluate("token-1", orderBook);
  expect(signal).toEqual([]);
});

test("MarketMakerStrategy tracks metrics", () => {
  strategy.onOrderFilled("order-1", "token-1", 0.5, 10);
  strategy.onOrderFilled("order-2", "token-1", 0.51, 10);

  const metrics = strategy.getMetrics();
  expect(metrics.totalTrades).toBe(2);
});
