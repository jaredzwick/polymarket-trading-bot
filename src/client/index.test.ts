import { test, expect } from "bun:test";
import { MockPolymarketClient } from "./index";
import { Side } from "../types";

test("MockPolymarketClient places and tracks orders", async () => {
  const client = new MockPolymarketClient();

  const result = await client.placeOrder({
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: "GTC" as any,
  });

  expect(result.success).toBe(true);
  expect(result.orderId).toBeDefined();

  const orders = await client.getOpenOrders();
  expect(orders.length).toBe(1);
  expect(orders[0].tokenId).toBe("token-1");
});

test("MockPolymarketClient cancels orders", async () => {
  const client = new MockPolymarketClient();

  const result = await client.placeOrder({
    tokenId: "token-1",
    side: Side.BUY,
    price: 0.5,
    size: 10,
    type: "GTC" as any,
  });

  const cancelled = await client.cancelOrder(result.orderId!);
  expect(cancelled).toBe(true);

  const orders = await client.getOpenOrders();
  expect(orders.length).toBe(0);
});

test("MockPolymarketClient provides orderbook", async () => {
  const client = new MockPolymarketClient();

  const orderBook = await client.getOrderBook("token-1");

  expect(orderBook.tokenId).toBe("token-1");
  expect(orderBook.bids.length).toBeGreaterThan(0);
  expect(orderBook.asks.length).toBeGreaterThan(0);
  expect(orderBook.midPrice).toBe(0.5);
});

test("MockPolymarketClient cancels all orders", async () => {
  const client = new MockPolymarketClient();

  await client.placeOrder({ tokenId: "t1", side: Side.BUY, price: 0.5, size: 10, type: "GTC" as any });
  await client.placeOrder({ tokenId: "t2", side: Side.SELL, price: 0.6, size: 10, type: "GTC" as any });

  await client.cancelAllOrders();

  const orders = await client.getOpenOrders();
  expect(orders.length).toBe(0);
});

test("MockPolymarketClient provides balances", async () => {
  const client = new MockPolymarketClient();

  const balances = await client.getBalances();

  expect(balances.collateral).toBe(10000);
  expect(balances.allowance).toBe(10000);
});
