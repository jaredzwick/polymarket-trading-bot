import { test, expect, beforeEach } from "bun:test";
import { MomentumStrategy } from "./momentum";
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

let strategy: MomentumStrategy;

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
  strategy = new MomentumStrategy(ctx, { windowSize: 5, threshold: 0.05 });
});

test("MomentumStrategy waits for enough data", () => {
  // Only 3 updates, need 5
  for (let i = 0; i < 3; i++) {
    const signal = strategy.evaluate("token-1", createOrderBook(0.5));
    expect(signal).toBeNull();
  }
});

test("MomentumStrategy detects upward momentum", () => {
  // Build up history with upward trend
  const prices = [0.50, 0.52, 0.54, 0.56, 0.58]; // 16% increase
  for (let i = 0; i < 4; i++) {
    strategy.evaluate("token-1", createOrderBook(prices[i]));
  }

  const signal = strategy.evaluate("token-1", createOrderBook(prices[4]));

  expect(signal).not.toBeNull();
  expect(signal!.side).toBe(Side.BUY);
  expect(signal!.reason).toContain("up");
});

test("MomentumStrategy detects downward momentum", () => {
  const prices = [0.50, 0.48, 0.46, 0.44, 0.42]; // 16% decrease
  for (let i = 0; i < 4; i++) {
    strategy.evaluate("token-1", createOrderBook(prices[i]));
  }

  const signal = strategy.evaluate("token-1", createOrderBook(prices[4]));

  expect(signal).not.toBeNull();
  expect(signal!.side).toBe(Side.SELL);
  expect(signal!.reason).toContain("down");
});

test("MomentumStrategy ignores small movements", () => {
  const prices = [0.50, 0.501, 0.502, 0.503, 0.504]; // Only 0.8% change
  for (let i = 0; i < 4; i++) {
    strategy.evaluate("token-1", createOrderBook(prices[i]));
  }

  const signal = strategy.evaluate("token-1", createOrderBook(prices[4]));
  expect(signal).toBeNull();
});
