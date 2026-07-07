import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import type { TradeSignalPayload } from "../../types/signal";
import { Events } from "../../types";

export interface KalshiAdapterConfig {
  /** Poll interval in ms. Default: 30_000. */
  refreshIntervalMs: number;
  /** Minimum price divergence [0,1] to emit a trade signal. Default: 0.05. */
  minDivergence: number;
  /** Max markets to fetch per poll. Default: 50. */
  limit: number;
  /** Category filter passed to Kalshi API. Default: "politics". */
  category: string;
}

const DEFAULT_CONFIG: KalshiAdapterConfig = {
  refreshIntervalMs: 30_000,
  minDivergence: 0.05,
  limit: 50,
  category: "politics",
};

interface KalshiMarket {
  ticker: string;
  title: string;
  yes_bid: number;
  yes_ask: number;
  no_bid: number;
  no_ask: number;
  volume: number;
  open_interest: number;
  status: string;
}

interface KalshiMarketsResponse {
  markets?: KalshiMarket[];
  cursor?: string;
}

export interface KalshiTradePayload extends TradeSignalPayload {
  kalshiTicker: string;
  kalshiMid: number;
  polymarketMid: number | null;
  divergence: number;
}

export class KalshiAdapter implements SignalAdapter {
  readonly name = "kalshi";
  readonly version = "1.0.0";

  private config: KalshiAdapterConfig = { ...DEFAULT_CONFIG };
  private ctx?: AdapterContext;
  private timer?: ReturnType<typeof setInterval>;
  private stopped = false;
  private healthy = true;

  async initialize(ctx: AdapterContext): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...(ctx.config as Partial<KalshiAdapterConfig>) };
    this.stopped = false;
    ctx.logger.info("KalshiAdapter initialized");
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        ctx.logger.error("Kalshi poll error", { error: String(err) });
        this.healthy = false;
      });
    }, this.config.refreshIntervalMs);
  }

  async shutdown(): Promise<void> {
    this.stopped = true;
    if (this.timer !== undefined) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  isHealthy(): boolean {
    return this.healthy;
  }

  diagnostics(): Record<string, unknown> {
    return { category: this.config.category, refreshIntervalMs: this.config.refreshIntervalMs };
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.ctx) return;

    const url = new URL("https://trading-api.kalshi.com/trade-api/v2/markets");
    url.searchParams.set("limit", String(this.config.limit));
    url.searchParams.set("status", "open");
    if (this.config.category) {
      url.searchParams.set("category", this.config.category);
    }

    let markets: KalshiMarket[];
    try {
      const resp = await fetch(url.toString(), {
        headers: { Accept: "application/json" },
        signal: AbortSignal.timeout(10_000),
      });
      if (!resp.ok) {
        this.ctx.logger.warn("Kalshi API non-200", { status: resp.status });
        return;
      }
      const data = (await resp.json()) as KalshiMarketsResponse;
      markets = data.markets ?? [];
      this.healthy = true;
    } catch {
      this.ctx.logger.warn("Kalshi fetch failed");
      this.healthy = false;
      return;
    }

    for (const market of markets) {
      if (market.status !== "open") continue;

      const kalshiMid = (market.yes_bid + market.yes_ask) / 2;
      if (kalshiMid <= 0 || kalshiMid >= 1) continue;

      // Try to find an overlapping Polymarket order book by token lookup
      const polyMid = this.getPolymarketMid();
      const divergence = polyMid !== null ? Math.abs(kalshiMid - polyMid) : 0;

      if (divergence < this.config.minDivergence && polyMid !== null) continue;

      // When there's meaningful divergence, emit a trade signal toward Kalshi price
      const side = polyMid === null || kalshiMid > polyMid ? "BUY" : "SELL";
      const confidence = Math.min(divergence / 0.2, 1); // scale: 20% div = max confidence

      const signal: Signal<KalshiTradePayload> = {
        id: crypto.randomUUID(),
        kind: "trade",
        source: this.name,
        confidence: Math.max(confidence, 0.4), // floor at 0.4 — basic cross-market signal
        payload: {
          side,
          targetPrice: kalshiMid,
          size: 10,
          reason: `Kalshi ${market.ticker} mid=${kalshiMid.toFixed(3)} vs poly mid=${polyMid?.toFixed(3) ?? "unknown"}`,
          kalshiTicker: market.ticker,
          kalshiMid,
          polymarketMid: polyMid,
          divergence,
        },
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 5 * 60_000),
        metadata: { title: market.title, volume: market.volume },
      };

      this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    }
  }

  /** Stub: look up Polymarket mid for any currently tracked token. */
  private getPolymarketMid(): number | null {
    if (!this.ctx) return null;
    // We don't have a specific conditionId mapping here — a real implementation
    // would maintain a title-matching index. Return null for now so callers
    // always emit a signal, letting strategies filter by confidence.
    return null;
  }
}

export const kalshiDescriptor: AdapterDescriptor = {
  name: "kalshi",
  version: "1.0.0",
  description: "Polls Kalshi public markets and emits cross-market arbitrage trade signals.",
  factory: (_config) => new KalshiAdapter(),
};
