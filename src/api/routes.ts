import type { DashboardContext } from "./context";
import type { BregmanArbStrategy } from "../strategies/bregman-arb";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function errJson(message: string, status = 500): Response {
  return json({ error: message }, status);
}

export function createRoutes(ctx: DashboardContext): Record<string, (req: Request) => Response | Promise<Response>> {
  return {
    "/api/status": () => {
      const status = ctx.bot.getStatus();
      return json({
        ...status,
        exposure: {
          total: status.exposure.total,
          byToken: Object.fromEntries(status.exposure.byToken),
        },
      });
    },

    "/api/arb/stats": () => {
      const bregman = ctx.bot.getStrategy("bregman-arb") as BregmanArbStrategy | undefined;
      if (!bregman) return errJson("bregman-arb strategy not active", 404);
      return json(bregman.getStats());
    },

    "/api/arb/metrics": () => {
      const bregman = ctx.bot.getStrategy("bregman-arb") as BregmanArbStrategy | undefined;
      if (!bregman) return errJson("bregman-arb strategy not active", 404);
      return json(bregman.getMetrics());
    },

    "/api/positions": () => {
      return json(ctx.deps.orderManager.getAllPositions());
    },

    "/api/orders": () => {
      return json(ctx.deps.orderManager.getOpenOrders());
    },

    "/api/trades": (req: Request) => {
      const url = new URL(req.url);
      const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
      return json(ctx.deps.store.getTrades(undefined, limit));
    },

    "/api/risk": () => {
      const exposure = ctx.deps.riskManager.getExposure();
      return json({
        exposure: {
          total: exposure.total,
          byToken: Object.fromEntries(exposure.byToken),
        },
        limits: ctx.deps.riskManager.getLimits(),
        halted: ctx.deps.riskManager.isHalted(),
        dailyPnl: ctx.deps.riskManager.getDailyPnl(),
      });
    },

    "/api/markets": () => {
      if (!ctx.gamma) return json([]);
      return json(ctx.gamma.getMarketGroups());
    },
  };
}

export function handleOrderbookRoute(ctx: DashboardContext, tokenId: string): Response {
  const book = ctx.deps.marketData.getOrderBook(tokenId);
  if (!book) return errJson("Order book not found", 404);
  return json(book);
}
