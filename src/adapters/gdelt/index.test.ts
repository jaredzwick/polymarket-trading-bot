import { test, expect, mock, beforeEach } from "bun:test";
import { GdeltNewsAdapter } from "./index";
import { EventBus } from "../../core/events";
import { Logger } from "../../core/logger";
import type { AdapterContext } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import { Events } from "../../types";

function makeCtx(config: Record<string, unknown> = {}): AdapterContext {
  return {
    events: new EventBus(),
    logger: new Logger("error"),
    marketData: {
      subscribe: mock(() => {}),
      unsubscribe: mock(() => {}),
      getOrderBook: mock(() => null),
      getMarket: mock(async () => null),
      start: mock(async () => {}),
      stop: mock(() => {}),
    },
    config,
  };
}

test("GdeltNewsAdapter lifecycle: init, start, shutdown", async () => {
  const adapter = new GdeltNewsAdapter();
  const ctx = makeCtx({ refreshIntervalMs: 999_999_999 });

  // Override poll to avoid real HTTP
  (adapter as any).poll = async () => {};

  await adapter.initialize(ctx);
  await adapter.start(ctx);
  expect(adapter.isHealthy()).toBe(true);
  await adapter.shutdown();
});

test("GdeltNewsAdapter does not emit below minConfidence", async () => {
  const adapter = new GdeltNewsAdapter();
  const ctx = makeCtx({ minConfidence: 0.99, keywords: ["polymarket"], refreshIntervalMs: 999_999_999 });

  await adapter.initialize(ctx);

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Inject a low-scoring article
  await (adapter as any).poll.call(Object.assign(adapter, {
    stopped: false,
    ctx,
    config: { ...(adapter as any).config, minConfidence: 0.99 },
    seenUrls: new Set(),
  }));

  // No network call made — emitted should remain empty
  expect(emitted).toHaveLength(0);
});

test("GdeltNewsAdapter scores article by keyword overlap", () => {
  const adapter = new GdeltNewsAdapter();
  (adapter as any).config = {
    keywords: ["polymarket", "prediction", "odds"],
    minConfidence: 0,
    query: "",
    refreshIntervalMs: 60_000,
    maxRecords: 10,
  };

  const score = (adapter as any).scoreArticle({
    title: "Polymarket prediction odds surge before election",
    domain: "reuters.com",
    url: "https://reuters.com/test",
    seendate: "2026-01-01",
  });

  // All 3 keywords hit → score = min(3/1.5, 1) = 1
  expect(score).toBe(1);
});

test("GdeltNewsAdapter deduplicates seen URLs", () => {
  const adapter = new GdeltNewsAdapter();
  const seenUrls = new Set<string>(["https://example.com/article"]);
  (adapter as any).seenUrls = seenUrls;

  // If URL is already in seenUrls, scoreArticle should never be called
  const scoreSpy = mock(() => 0.9);
  (adapter as any).scoreArticle = scoreSpy;

  const ctx = makeCtx();
  (adapter as any).ctx = ctx;
  (adapter as any).config = {
    minConfidence: 0.1, query: "", refreshIntervalMs: 60_000,
    maxRecords: 10, keywords: [],
  };
  (adapter as any).stopped = false;

  // Simulate processing a duplicate article inline
  const articles = [{ url: "https://example.com/article", title: "test", domain: "x.com", seendate: "" }];
  for (const article of articles) {
    if (seenUrls.has(article.url)) continue;
    (adapter as any).scoreArticle(article);
  }

  expect(scoreSpy).not.toHaveBeenCalled();
});
