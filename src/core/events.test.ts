import { test, expect, mock } from "bun:test";
import { EventBus } from "./events";

test("EventBus emits events to handlers", () => {
  const bus = new EventBus();
  let receivedEvent: any = null;
  const handler = mock((event: any) => { receivedEvent = event; });

  bus.on("orderbook_update", handler);
  bus.emit("orderbook_update", { tokenId: "test" });

  expect(handler).toHaveBeenCalledTimes(1);
  expect(receivedEvent).toMatchObject({
    type: "orderbook_update",
    data: { tokenId: "test" },
  });
});

test("EventBus allows unsubscribing", () => {
  const bus = new EventBus();
  const handler = mock(() => { });

  const unsubscribe = bus.on("trade_executed", handler);
  unsubscribe();
  bus.emit("trade_executed", {});

  expect(handler).not.toHaveBeenCalled();
});

test("EventBus once fires only once", () => {
  const bus = new EventBus();
  const handler = mock(() => { });

  bus.once("order_filled", handler);
  bus.emit("order_filled", { id: 1 });
  bus.emit("order_filled", { id: 2 });

  expect(handler).toHaveBeenCalledTimes(1);
});

test("EventBus handles multiple handlers", () => {
  const bus = new EventBus();
  const handler1 = mock(() => { });
  const handler2 = mock(() => { });

  bus.on("position_changed", handler1);
  bus.on("position_changed", handler2);
  bus.emit("position_changed", {});

  expect(handler1).toHaveBeenCalledTimes(1);
  expect(handler2).toHaveBeenCalledTimes(1);
});
