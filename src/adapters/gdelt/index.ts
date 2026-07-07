import type { SignalAdapter, AdapterContext, AdapterDescriptor } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import { Events } from "../../types";

export interface GdeltAdapterConfig {
  /** GDELT doc search query string. */
  query: string;
  /** Poll interval in ms. Default: 60_000. */
  refreshIntervalMs: number;
  /** Max articles per fetch. Default: 10. */
  maxRecords: number;
  /** Minimum confidence [0,1] to emit a signal. Default: 0.3. */
  minConfidence: number;
  /** Keywords scored against title+domain to compute confidence. */
  keywords: string[];
}

const DEFAULT_CONFIG: GdeltAdapterConfig = {
  query: "polymarket prediction market probability",
  refreshIntervalMs: 60_000,
  maxRecords: 10,
  minConfidence: 0.3,
  keywords: ["polymarket", "prediction", "probability", "election", "market", "odds"],
};

interface GdeltArticle {
  url: string;
  title: string;
  seendate: string;
  domain: string;
}

export interface GdeltNewsPayload {
  headline: string;
  url: string;
  domain: string;
}

export class GdeltNewsAdapter implements SignalAdapter {
  readonly name = "gdelt-news";
  readonly version = "1.0.0";

  private config: GdeltAdapterConfig = { ...DEFAULT_CONFIG };
  private ctx?: AdapterContext;
  private timer?: ReturnType<typeof setInterval>;
  private seenUrls = new Set<string>();
  private stopped = false;
  private healthy = true;

  async initialize(ctx: AdapterContext): Promise<void> {
    this.config = { ...DEFAULT_CONFIG, ...(ctx.config as Partial<GdeltAdapterConfig>) };
    this.stopped = false;
    ctx.logger.info("GdeltNewsAdapter initialized", { query: this.config.query });
  }

  async start(ctx: AdapterContext): Promise<void> {
    this.ctx = ctx;
    await this.poll();
    this.timer = setInterval(() => {
      this.poll().catch((err) => {
        ctx.logger.error("GDELT poll error", { error: String(err) });
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
    return { seenUrls: this.seenUrls.size, query: this.config.query };
  }

  private async poll(): Promise<void> {
    if (this.stopped || !this.ctx) return;
    if (!Bun.env.GDELT_ENABLED) return;

    const url = new URL("https://api.gdeltproject.org/api/v2/doc/doc");
    url.searchParams.set("query", this.config.query);
    url.searchParams.set("mode", "artlist");
    url.searchParams.set("format", "json");
    url.searchParams.set("maxrecords", String(this.config.maxRecords));
    url.searchParams.set("timespan", "1h");

    let articles: GdeltArticle[];
    try {
      const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(10_000) });
      if (!resp.ok) {
        this.ctx.logger.warn("GDELT API non-200", { status: resp.status });
        return;
      }
      const data = (await resp.json()) as { articles?: GdeltArticle[] };
      articles = data.articles ?? [];
      this.healthy = true;
    } catch {
      this.ctx.logger.warn("GDELT fetch failed");
      this.healthy = false;
      return;
    }

    for (const article of articles) {
      if (this.seenUrls.has(article.url)) continue;
      this.seenUrls.add(article.url);

      const confidence = this.scoreArticle(article);
      if (confidence < this.config.minConfidence) continue;

      const signal: Signal<GdeltNewsPayload> = {
        id: crypto.randomUUID(),
        kind: "news",
        source: this.name,
        confidence,
        payload: { headline: article.title, url: article.url, domain: article.domain },
        timestamp: new Date(),
        expiresAt: new Date(Date.now() + 30 * 60_000),
      };

      this.ctx.events.emit(Events.SIGNAL_EMITTED, signal);
    }
  }

  private scoreArticle(article: GdeltArticle): number {
    const text = `${article.title} ${article.domain}`.toLowerCase();
    let hits = 0;
    for (const kw of this.config.keywords) {
      if (text.includes(kw.toLowerCase())) hits++;
    }
    const denominator = Math.max(this.config.keywords.length * 0.5, 1);
    return Math.min(hits / denominator, 1);
  }
}

export const gdeltDescriptor: AdapterDescriptor = {
  name: "gdelt-news",
  version: "1.0.0",
  description: "Polls GDELT for prediction-market-relevant news headlines.",
  factory: (_config) => new GdeltNewsAdapter(),
};
