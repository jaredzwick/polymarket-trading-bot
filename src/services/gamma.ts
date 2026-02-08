import type { IEventBus } from "../core/events";
import type { ILogger } from "../core/logger";
import { Events, type GammaConfig, type MarketGroup } from "../types";

const DEFAULT_CONFIG: GammaConfig = {
  baseUrl: "https://gamma-api.polymarket.com",
  tags: ["earnings"],
  refreshIntervalMs: 30_000,
  active: true,
  closed: false,
  limit: 100,
};

export class GammaService {
  private config: GammaConfig;
  private events: IEventBus;
  private logger: ILogger;
  private interval: ReturnType<typeof setInterval> | null = null;
  private currentGroups: MarketGroup[] = [];

  constructor(events: IEventBus, logger: ILogger, config: Partial<GammaConfig> = {}) {
    this.events = events;
    this.logger = logger.child({ service: "Gamma" });
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async start(): Promise<void> {
    this.logger.info("Starting Gamma service", {
      tags: this.config.tags,
      refreshIntervalMs: this.config.refreshIntervalMs,
    });
    await this.fetchAndUpdate();
    this.interval = setInterval(() => this.fetchAndUpdate(), this.config.refreshIntervalMs);
  }

  stop(): void {
    if (this.interval) {
      clearInterval(this.interval);
      this.interval = null;
    }
    this.logger.info("Stopped Gamma service");
  }

  getMarketGroups(): MarketGroup[] {
    return this.currentGroups;
  }

  async fetchAndUpdate(): Promise<void> {
    try {
      const groups = await this.fetchMarketGroups();
      if (this.hasChanged(groups)) {
        this.currentGroups = groups;
        this.logger.info("Market groups updated", {
          count: groups.length,
          tokenCount: groups.reduce((sum, g) => sum + g.tokenIds.length, 0),
        });
        this.events.emit(Events.MARKET_GROUPS_UPDATED, { groups });
      } else {
        this.logger.debug("Gamma refresh: no changes", {
          groups: groups.length,
        });
      }
    } catch (err) {
      this.logger.info("Failed to fetch market groups from Gamma", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  private async fetchMarketGroups(): Promise<MarketGroup[]> {
    const params = new URLSearchParams();
    for (const tag of this.config.tags) {
      params.append("tag", tag);
    }
    params.set("closed", String(this.config.closed));
    params.set("active", String(this.config.active));
    params.set("limit", String(this.config.limit));

    const url = `${this.config.baseUrl}/events?${params.toString()}`;
    this.logger.debug("Fetching events from Gamma", { url });

    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Gamma API returned ${response.status}: ${response.statusText}`);
    }

    const events: GammaEvent[] = await response.json();
    return this.extractMarketGroups(events);
  }

  extractMarketGroups(events: GammaEvent[]): MarketGroup[] {
    const groups: MarketGroup[] = [];

    for (const event of events) {
      if (!event.markets || event.markets.length === 0) continue;

      if (event.negRisk && event.markets.length > 1) {
        // Multi-outcome neg-risk event: take "Yes" token (index 0) from each sub-market
        const tokenIds: string[] = [];
        for (const market of event.markets) {
          const clobTokenIds = parseClobTokenIds(market.clobTokenIds);
          if (clobTokenIds.length > 0) {
            tokenIds.push(clobTokenIds[0]); // Yes token
          }
        }
        if (tokenIds.length >= 2) {
          groups.push({
            conditionId: event.markets[0].conditionId,
            tokenIds,
          });
        }
      } else if (event.markets.length === 1) {
        // Single binary market: use both tokens
        const market = event.markets[0];
        const clobTokenIds = parseClobTokenIds(market.clobTokenIds);
        if (clobTokenIds.length === 2) {
          groups.push({
            conditionId: market.conditionId,
            tokenIds: clobTokenIds,
          });
        }
      }
    }

    return groups;
  }

  private hasChanged(newGroups: MarketGroup[]): boolean {
    if (newGroups.length !== this.currentGroups.length) return true;
    const serialize = (groups: MarketGroup[]) =>
      groups.map((g) => `${g.conditionId}:${g.tokenIds.join(",")}`).sort().join(";");
    return serialize(newGroups) !== serialize(this.currentGroups);
  }
}

// Gamma API response types (minimal)
export interface GammaEvent {
  id: string;
  title: string;
  slug: string;
  negRisk: boolean;
  markets: GammaMarket[];
}

export interface GammaMarket {
  conditionId: string;
  question: string;
  clobTokenIds: string; // JSON string: '["tokenA","tokenB"]'
  active: boolean;
  closed: boolean;
}

function parseClobTokenIds(raw: string): string[] {
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}
