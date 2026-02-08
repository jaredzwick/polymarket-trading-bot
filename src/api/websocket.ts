import type { ServerWebSocket } from "bun";
import type { DashboardContext } from "./context";
import type { BregmanArbStrategy } from "../strategies/bregman-arb";
import { Events, type EventType } from "../types";

interface WsData {
  subscribedOrderbooks: Set<string>;
}

const STREAMED_EVENTS: EventType[] = [
  Events.TRADE_EXECUTED,
  Events.ORDER_FILLED,
  Events.ORDER_CANCELLED,
  Events.POSITION_CHANGED,
  Events.STRATEGY_SIGNAL,
  Events.RISK_BREACH,
  Events.MARKET_GROUPS_UPDATED,
];

export function setupWebSocket(ctx: DashboardContext) {
  const clients = new Set<ServerWebSocket<WsData>>();
  const unsubscribers: (() => void)[] = [];

  // Subscribe to streamed events and fan out to clients
  for (const eventType of STREAMED_EVENTS) {
    const unsub = ctx.deps.events.on(eventType, (event) => {
      const msg = JSON.stringify({ type: "event", event: eventType, data: event.data, timestamp: event.timestamp });
      for (const ws of clients) {
        ws.send(msg);
      }
    });
    unsubscribers.push(unsub);
  }

  // Orderbook updates — only to opted-in clients
  const orderbookUnsub = ctx.deps.events.on(Events.ORDERBOOK_UPDATE, (event) => {
    const { tokenId } = event.data as { tokenId: string };
    const msg = JSON.stringify({ type: "event", event: "orderbook_update", data: event.data, timestamp: event.timestamp });
    for (const ws of clients) {
      if (ws.data.subscribedOrderbooks.has(tokenId)) {
        ws.send(msg);
      }
    }
  });
  unsubscribers.push(orderbookUnsub);

  // 5-second snapshot heartbeat
  const heartbeat = setInterval(() => {
    if (clients.size === 0) return;

    const bregman = ctx.bot.getStrategy("bregman-arb") as BregmanArbStrategy | undefined;
    const exposure = ctx.deps.riskManager.getExposure();

    const snapshot = JSON.stringify({
      type: "snapshot",
      data: {
        arbStats: bregman?.getStats() ?? null,
        arbMetrics: bregman?.getMetrics() ?? null,
        risk: {
          exposure: { total: exposure.total, byToken: Object.fromEntries(exposure.byToken) },
          halted: ctx.deps.riskManager.isHalted(),
          dailyPnl: ctx.deps.riskManager.getDailyPnl(),
        },
        positionCount: ctx.deps.orderManager.getAllPositions().length,
        orderCount: ctx.deps.orderManager.getOpenOrders().length,
        running: ctx.bot.isRunning(),
      },
      timestamp: new Date(),
    });

    for (const ws of clients) {
      ws.send(snapshot);
    }
  }, 5000);

  return {
    open(ws: ServerWebSocket<WsData>) {
      clients.add(ws);
    },
    message(ws: ServerWebSocket<WsData>, message: string | Buffer) {
      try {
        const parsed = JSON.parse(typeof message === "string" ? message : message.toString());
        if (parsed.action === "subscribe_orderbook" && parsed.tokenId) {
          ws.data.subscribedOrderbooks.add(parsed.tokenId);
        } else if (parsed.action === "unsubscribe_orderbook" && parsed.tokenId) {
          ws.data.subscribedOrderbooks.delete(parsed.tokenId);
        }
      } catch {
        // Ignore malformed messages
      }
    },
    close(ws: ServerWebSocket<WsData>) {
      clients.delete(ws);
    },
    cleanup() {
      clearInterval(heartbeat);
      for (const unsub of unsubscribers) unsub();
      clients.clear();
    },
  };
}
