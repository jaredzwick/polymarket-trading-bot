import type { DashboardContext } from "./context";
import { createRoutes, handleOrderbookRoute } from "./routes";
import { setupWebSocket } from "./websocket";
import index from "../dashboard/index.html";

export function createDashboardServer(ctx: DashboardContext, port: number) {
  const routes = createRoutes(ctx);
  const ws = setupWebSocket(ctx);

  const server = Bun.serve({
    port,
    routes: {
      "/": index,
      ...routes,
    },
    fetch(req, server) {
      const url = new URL(req.url);

      // WebSocket upgrade
      if (url.pathname === "/ws") {
        const upgraded = server.upgrade(req, {
          data: { subscribedOrderbooks: new Set<string>() },
        });
        if (upgraded) return undefined as unknown as Response;
        return new Response("WebSocket upgrade failed", { status: 400 });
      }

      // Orderbook route: /api/orderbook/:tokenId
      const orderbookMatch = url.pathname.match(/^\/api\/orderbook\/(.+)$/);
      if (orderbookMatch) {
        return handleOrderbookRoute(ctx, orderbookMatch[1]);
      }

      return new Response("Not Found", { status: 404 });
    },
    websocket: {
      open: ws.open,
      message: ws.message,
      close: ws.close,
    },
  });

  return {
    stop() {
      ws.cleanup();
      server.stop();
    },
  };
}
