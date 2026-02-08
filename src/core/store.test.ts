import { test, expect, beforeEach, afterEach } from "bun:test";
import { SQLiteStore } from "./store";
import { Side, OrderType } from "../types";

let store: SQLiteStore;

beforeEach(() => {
  store = new SQLiteStore(":memory:");
});

afterEach(() => {
  store.close();
});

test("SQLiteStore saves and retrieves positions", () => {
  const position = {
    tokenId: "token-1",
    market: "market-1",
    size: 100,
    avgEntryPrice: 0.5,
    currentPrice: 0.55,
    unrealizedPnl: 5,
    realizedPnl: 0,
    side: Side.BUY,
  };

  store.savePosition(position);
  const retrieved = store.getPosition("token-1");

  expect(retrieved).toMatchObject(position);
});

test("SQLiteStore returns null for non-existent position", () => {
  const position = store.getPosition("non-existent");
  expect(position).toBeNull();
});

test("SQLiteStore gets all positions with non-zero size", () => {
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
  store.savePosition({
    tokenId: "token-2",
    market: "m2",
    size: 0, // Closed position
    avgEntryPrice: 0.5,
    currentPrice: 0.5,
    unrealizedPnl: 0,
    realizedPnl: 10,
    side: Side.BUY,
  });

  const positions = store.getAllPositions();
  expect(positions.length).toBe(1);
  expect(positions[0].tokenId).toBe("token-1");
});

test("SQLiteStore saves and updates orders", () => {
  const order = {
    orderId: "order-1",
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: OrderType.GTC,
    status: "open",
  };

  store.saveOrder(order);
  let openOrders = store.getOpenOrders();
  expect(openOrders.length).toBe(1);
  expect(openOrders[0].orderId).toBe("order-1");

  store.updateOrderStatus("order-1", "filled");
  openOrders = store.getOpenOrders();
  expect(openOrders.length).toBe(0);
});

test("SQLiteStore saves and retrieves trades", () => {
  const trade = {
    id: "trade-1",
    strategyId: "market-maker",
    taker_order_id: "taker-1",
    market: "market-1",
    asset_id: "token-1",
    side: Side.BUY,
    size: "100",
    fee_rate_bps: "10",
    price: "0.5",
    status: "filled",
    match_time: new Date().toISOString(),
    last_update: new Date().toISOString(),
    outcome: "Yes",
    bucket_index: 0,
    owner: "0x123",
    maker_address: "0x456",
    maker_orders: [],
    transaction_hash: "0xabc",
    trader_side: "TAKER" as const,
  };

  store.saveTrade(trade);
  const trades = store.getTrades("token-1");

  expect(trades.length).toBe(1);
  expect(trades[0].id).toBe("trade-1");
  expect(trades[0].strategyId).toBe("market-maker");
});
