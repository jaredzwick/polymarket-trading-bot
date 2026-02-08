import { test, expect, beforeEach, mock } from "bun:test";
import { RiskManager } from "./risk-manager";
import { SQLiteStore } from "../core/store";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import { Side, OrderType } from "../types";

let riskManager: RiskManager;
let store: SQLiteStore;
let events: EventBus;

beforeEach(() => {
  store = new SQLiteStore(":memory:");
  events = new EventBus();
  const logger = new Logger("error");

  riskManager = new RiskManager(
    {
      maxPositionSize: 100,
      maxTotalExposure: 500,
      maxLossPerTrade: 10,
      maxDailyLoss: 50,
      maxOpenOrders: 5,
    },
    store,
    events,
    logger
  );
});

test("RiskManager allows valid orders", () => {
  const result = riskManager.checkOrder({
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: OrderType.GTC,
  });

  expect(result.allowed).toBe(true);
});

test("RiskManager rejects orders exceeding position size", () => {
  const result = riskManager.checkOrder({
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 250, // 0.5 * 250 = 125 > maxPositionSize(100)
    type: OrderType.GTC,
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("max position size");
});

test("RiskManager rejects when max orders reached", () => {
  // Add 5 open orders
  for (let i = 0; i < 5; i++) {
    store.saveOrder({
      orderId: `order-${i}`,
      tokenId: `token-${i}`,
      side: Side.BUY,
      price: 0.5,
      size: 10,
      type: OrderType.GTC,
      status: "open",
    });
  }

  const result = riskManager.checkOrder({
    tokenId: "token-new",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: OrderType.GTC,
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("Max open orders");
});

test("RiskManager halts trading on command", () => {
  riskManager.halt("Test halt");
  expect(riskManager.isHalted()).toBe(true);

  const result = riskManager.checkOrder({
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: OrderType.GTC,
  });

  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("Trading halted");
});

test("RiskManager resumes trading", () => {
  riskManager.halt("Test halt");
  riskManager.resume();
  expect(riskManager.isHalted()).toBe(false);
});

test("RiskManager emits risk_breach event on halt", () => {
  const handler = mock(() => {});
  events.on("risk_breach", handler);

  riskManager.halt("Test breach");

  expect(handler).toHaveBeenCalled();
});

test("RiskManager calculates exposure correctly", () => {
  store.savePosition({
    tokenId: "token-1",
    market: "m1",
    size: 100,
    avgEntryPrice: 0.5,
    currentPrice: 0.5,
    unrealizedPnl: 0,
    realizedPnl: 0,
    side: Side.BUY,
  });

  store.saveOrder({
    orderId: "order-1",
    tokenId: "token-2",
    side: Side.BUY,
    price: 0.4,
    size: 50,
    type: OrderType.GTC,
    status: "open",
  });

  const exposure = riskManager.getExposure();

  // Position: 100 * 0.5 = 50
  // Order: 50 * 0.4 = 20
  expect(exposure.total).toBe(70);
  expect(exposure.byToken.get("token-1")).toBe(50);
  expect(exposure.byToken.get("token-2")).toBe(20);
});

test("RiskManager updates limits", () => {
  riskManager.updateLimits({ maxPositionSize: 200 });
  const limits = riskManager.getLimits();
  expect(limits.maxPositionSize).toBe(200);
  expect(limits.maxTotalExposure).toBe(500); // Unchanged
});
