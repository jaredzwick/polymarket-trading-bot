import { test, expect, beforeEach } from "bun:test";
import { MeanReversionStrategy } from "./mean-reversion";
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

let strategy: MeanReversionStrategy;

function createOrderBook(midPrice: number): OrderBook {
  return {
    tokenId: "token-1",
    bids: [{ price: midPrice - 0.01, size: 100 }],
    asks: [{ price: midPrice + 0.01, size: 100 }],
    spread: 0.02,
    midPrice,
    timestamp: new Date(),
  };
}

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

  const ctx: StrategyContext = { marketData, orderManager, events, logger };
  strategy = new MeanReversionStrategy(ctx, { windowSize: 10, stdDevThreshold: 2 });
});

test("MeanReversionStrategy waits for enough data", () => {
  for (let i = 0; i < 5; i++) {
    const signal = strategy.evaluate("token-1", createOrderBook(0.5));
    expect(signal).toEqual([]);
  }
});

test("MeanReversionStrategy sells when price too high", () => {
  // Build stable history around 0.5
  for (let i = 0; i < 9; i++) {
    strategy.evaluate("token-1", createOrderBook(0.50));
  }

  // Spike up significantly
  const signal = strategy.evaluate("token-1", createOrderBook(0.58));

  expect(signal.length).toBe(1);
  expect(signal[0].side).toBe(Side.SELL);
  expect(signal[0].reason).toContain("Mean reversion");
});

test("MeanReversionStrategy buys when price too low", () => {
  for (let i = 0; i < 9; i++) {
    strategy.evaluate("token-1", createOrderBook(0.50));
  }

  // Drop significantly
  const signal = strategy.evaluate("token-1", createOrderBook(0.42));

  expect(signal.length).toBe(1);
  expect(signal[0].side).toBe(Side.BUY);
  expect(signal[0].reason).toContain("Mean reversion");
});

test("MeanReversionStrategy ignores normal fluctuations", () => {
  // Build history with some variance
  const prices = [0.50, 0.51, 0.49, 0.50, 0.51, 0.49, 0.50, 0.51, 0.49, 0.50];
  for (const price of prices) {
    strategy.evaluate("token-1", createOrderBook(price));
  }

  // Within normal range
  const signal = strategy.evaluate("token-1", createOrderBook(0.505));
  expect(signal).toEqual([]);
});

test("MeanReversionStrategy targets mean price", () => {
  for (let i = 0; i < 9; i++) {
    strategy.evaluate("token-1", createOrderBook(0.50));
  }

  const signal = strategy.evaluate("token-1", createOrderBook(0.58));

  expect(signal.length).toBe(1);
  expect(signal[0].targetPrice).toBeCloseTo(0.508, 1); // Mean of 9x0.50 + 1x0.58
});
