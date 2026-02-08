import type { IPolymarketClient } from "../client";
import type { IEventBus } from "../core/events";
import type { ILogger } from "../core/logger";
import { Events, type OrderBook, type Market } from "../types";

export interface IMarketDataService {
  subscribe(tokenIds: string[]): void;
  unsubscribe(tokenIds: string[]): void;
  getOrderBook(tokenId: string): OrderBook | null;
  getMarket(conditionId: string): Promise<Market | null>;
  start(): Promise<void>;
  stop(): void;
}

export class MarketDataService implements IMarketDataService {
  private client: IPolymarketClient;
  private events: IEventBus;
  private logger: ILogger;
  private subscriptions = new Set<string>();
  private orderBooks = new Map<string, OrderBook>();
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private pollIntervalMs: number;

  constructor(
    client: IPolymarketClient,
    events: IEventBus,
    logger: ILogger,
    pollIntervalMs = 1000
  ) {
    this.client = client;
    this.events = events;
    this.logger = logger.child({ service: "MarketData" });
    this.pollIntervalMs = pollIntervalMs;
  }

  subscribe(tokenIds: string[]): void {
    for (const tokenId of tokenIds) {
      this.subscriptions.add(tokenId);
    }
    this.logger.debug("Subscribed to tokens", { count: tokenIds.length });
  }

  unsubscribe(tokenIds: string[]): void {
    for (const tokenId of tokenIds) {
      this.subscriptions.delete(tokenId);
      this.orderBooks.delete(tokenId);
    }
  }

  getOrderBook(tokenId: string): OrderBook | null {
    return this.orderBooks.get(tokenId) ?? null;
  }

  async getMarket(conditionId: string): Promise<Market | null> {
    return this.client.getMarket(conditionId);
  }

  async start(): Promise<void> {
    this.logger.info("Starting market data service");
    await this.poll();
    this.pollInterval = setInterval(() => this.poll(), this.pollIntervalMs);
  }

  stop(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.logger.info("Stopped market data service");
  }

  private async poll(): Promise<void> {
    const tokens = Array.from(this.subscriptions);
    if (tokens.length === 0) return;

    await Promise.all(
      tokens.map(async (tokenId) => {
        try {
          const orderBook = await this.client.getOrderBook(tokenId);
          this.orderBooks.set(tokenId, orderBook);
          this.events.emit(Events.ORDERBOOK_UPDATE, { tokenId, orderBook });
        } catch (err) {
          this.logger.error("Failed to fetch orderbook", {
            tokenId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      })
    );
  }
}
