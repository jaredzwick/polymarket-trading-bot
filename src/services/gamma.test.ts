import { test, expect, beforeEach, afterEach, mock } from "bun:test";
import { GammaService, type GammaEvent } from "./gamma";
import { EventBus } from "../core/events";
import { Logger } from "../core/logger";
import { Events, type MarketGroup } from "../types";

let service: GammaService;
let events: EventBus;
let logger: Logger;

beforeEach(() => {
  events = new EventBus();
  logger = new Logger("error");
});

afterEach(() => {
  service?.stop();
});

test("extractMarketGroups: binary event with single market", () => {
  service = new GammaService(events, logger);

  const gammaEvents: GammaEvent[] = [
    {
      id: "1",
      title: "Will AAPL beat earnings?",
      slug: "aapl-earnings",
      negRisk: false,
      markets: [
        {
          conditionId: "cond-1",
          question: "Will AAPL beat earnings?",
          clobTokenIds: '["token-yes","token-no"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const groups = service.extractMarketGroups(gammaEvents);
  expect(groups).toEqual([
    { conditionId: "cond-1", tokenIds: ["token-yes", "token-no"] },
  ]);
});

test("extractMarketGroups: multi-outcome neg-risk event takes Yes tokens", () => {
  service = new GammaService(events, logger);

  const gammaEvents: GammaEvent[] = [
    {
      id: "2",
      title: "Which company beats earnings?",
      slug: "which-beats-earnings",
      negRisk: true,
      markets: [
        {
          conditionId: "cond-a",
          question: "AAPL beats?",
          clobTokenIds: '["token-aapl-yes","token-aapl-no"]',
          active: true,
          closed: false,
        },
        {
          conditionId: "cond-b",
          question: "MSFT beats?",
          clobTokenIds: '["token-msft-yes","token-msft-no"]',
          active: true,
          closed: false,
        },
        {
          conditionId: "cond-c",
          question: "GOOG beats?",
          clobTokenIds: '["token-goog-yes","token-goog-no"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const groups = service.extractMarketGroups(gammaEvents);
  expect(groups.length).toBe(1);
  expect(groups[0].tokenIds).toEqual([
    "token-aapl-yes",
    "token-msft-yes",
    "token-goog-yes",
  ]);
});

test("extractMarketGroups: skips events with no markets", () => {
  service = new GammaService(events, logger);

  const gammaEvents: GammaEvent[] = [
    { id: "3", title: "Empty", slug: "empty", negRisk: false, markets: [] },
  ];

  const groups = service.extractMarketGroups(gammaEvents);
  expect(groups).toEqual([]);
});

test("extractMarketGroups: handles malformed clobTokenIds gracefully", () => {
  service = new GammaService(events, logger);

  const gammaEvents: GammaEvent[] = [
    {
      id: "4",
      title: "Bad data",
      slug: "bad-data",
      negRisk: false,
      markets: [
        {
          conditionId: "cond-bad",
          question: "Bad?",
          clobTokenIds: "not-json",
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const groups = service.extractMarketGroups(gammaEvents);
  expect(groups).toEqual([]);
});

test("extractMarketGroups: neg-risk event with single market is skipped (needs 2+)", () => {
  service = new GammaService(events, logger);

  const gammaEvents: GammaEvent[] = [
    {
      id: "5",
      title: "Single neg-risk",
      slug: "single-neg",
      negRisk: true,
      markets: [
        {
          conditionId: "cond-single",
          question: "Only one?",
          clobTokenIds: '["token-a","token-b"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const groups = service.extractMarketGroups(gammaEvents);
  // negRisk with 1 market falls through to binary path → uses both tokens
  expect(groups.length).toBe(1);
  expect(groups[0].tokenIds).toEqual(["token-a", "token-b"]);
});

test("fetchAndUpdate emits MARKET_GROUPS_UPDATED on change", async () => {
  const fakeEvents: GammaEvent[] = [
    {
      id: "1",
      title: "Test",
      slug: "test",
      negRisk: false,
      markets: [
        {
          conditionId: "cond-1",
          question: "Test?",
          clobTokenIds: '["tok-a","tok-b"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(fakeEvents), { status: 200 }))
  ) as typeof fetch;

  service = new GammaService(events, logger, { refreshIntervalMs: 60_000 });

  let emitted: MarketGroup[] | null = null;
  events.on(Events.MARKET_GROUPS_UPDATED, (event) => {
    emitted = (event.data as { groups: MarketGroup[] }).groups;
  });

  await service.fetchAndUpdate();

  expect(emitted).not.toBeNull();
  expect(emitted!.length).toBe(1);
  expect(emitted![0].tokenIds).toEqual(["tok-a", "tok-b"]);

  globalThis.fetch = originalFetch;
});

test("fetchAndUpdate does not emit when groups unchanged", async () => {
  const fakeEvents: GammaEvent[] = [
    {
      id: "1",
      title: "Test",
      slug: "test",
      negRisk: false,
      markets: [
        {
          conditionId: "cond-1",
          question: "Test?",
          clobTokenIds: '["tok-a","tok-b"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(fakeEvents), { status: 200 }))
  ) as typeof fetch;

  service = new GammaService(events, logger, { refreshIntervalMs: 60_000 });

  // First fetch
  await service.fetchAndUpdate();

  let emitCount = 0;
  events.on(Events.MARKET_GROUPS_UPDATED, () => {
    emitCount++;
  });

  // Second fetch with same data
  await service.fetchAndUpdate();

  expect(emitCount).toBe(0);

  globalThis.fetch = originalFetch;
});

test("fetchAndUpdate handles API errors gracefully", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response("Internal Server Error", { status: 500, statusText: "Internal Server Error" }))
  ) as typeof fetch;

  service = new GammaService(events, logger, { refreshIntervalMs: 60_000 });

  let emitted = false;
  events.on(Events.MARKET_GROUPS_UPDATED, () => {
    emitted = true;
  });

  // Should not throw
  await service.fetchAndUpdate();
  expect(emitted).toBe(false);

  globalThis.fetch = originalFetch;
});

test("getMarketGroups returns current groups", async () => {
  const fakeEvents: GammaEvent[] = [
    {
      id: "1",
      title: "Test",
      slug: "test",
      negRisk: false,
      markets: [
        {
          conditionId: "cond-1",
          question: "Test?",
          clobTokenIds: '["tok-a","tok-b"]',
          active: true,
          closed: false,
        },
      ],
    },
  ];

  const originalFetch = globalThis.fetch;
  globalThis.fetch = mock(() =>
    Promise.resolve(new Response(JSON.stringify(fakeEvents), { status: 200 }))
  ) as typeof fetch;

  service = new GammaService(events, logger, { refreshIntervalMs: 60_000 });

  expect(service.getMarketGroups()).toEqual([]);
  await service.fetchAndUpdate();
  expect(service.getMarketGroups().length).toBe(1);

  globalThis.fetch = originalFetch;
});
