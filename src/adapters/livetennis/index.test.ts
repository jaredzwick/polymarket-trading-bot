import { test, expect, mock } from "bun:test";
import { LiveTennisAdapter } from "./index";
import { EventBus } from "../../core/events";
import { Logger } from "../../core/logger";
import type { AdapterContext } from "../../types/adapter";
import type { Signal } from "../../types/signal";
import type {
  LiveTennisTradePayload,
  LiveTennisRiskPayload,
  LiveTennisMarketMapping,
} from "./index";
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

test("LiveTennisAdapter lifecycle: init, start, shutdown", async () => {
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ refreshIntervalMs: 999_999_999, markets: [] });

  // Override poll to avoid real HTTP
  (adapter as any).poll = async () => {};

  await adapter.initialize(ctx);
  await adapter.start(ctx);
  expect(adapter.isHealthy()).toBe(true);
  await adapter.shutdown();
});

test("breakPointState: receiver at 40, server behind → break point", () => {
  // server = 1 (p1 serves), p2 receives at 40, p1 at 30 → break point for p2
  expect(
    LiveTennisAdapter.breakPointState({ server: 1, points: ["30", "40"] })
  ).toBe("p2");

  // server = 2 (p2 serves), p1 receives at AD, p2 at 15 → break point for p1
  expect(
    LiveTennisAdapter.breakPointState({ server: 2, points: ["AD", "15"] })
  ).toBe("p1");
});

test("breakPointState: deuce, tiebreak, and null are not break points", () => {
  // 40-40 deuce: server not behind (40 ∉ {0,15,30})
  expect(LiveTennisAdapter.breakPointState({ server: 1, points: ["40", "40"] })).toBeNull();
  // receiver only at 30 (not 40/AD)
  expect(LiveTennisAdapter.breakPointState({ server: 1, points: ["0", "30"] })).toBeNull();
  // tiebreak → undefined
  expect(
    LiveTennisAdapter.breakPointState({ server: 1, points: ["6", "5"], is_tiebreak: true })
  ).toBeNull();
  // null points / server → undefined
  expect(LiveTennisAdapter.breakPointState({ server: null, points: ["40", "0"] })).toBeNull();
  expect(LiveTennisAdapter.breakPointState({ server: 1, points: [null, null] })).toBeNull();
  expect(LiveTennisAdapter.breakPointState(undefined)).toBeNull();
});

test("processMatch emits a BUY trade signal when the mapped player holds break point", async () => {
  const markets: LiveTennisMarketMapping[] = [
    { matchId: 42, tokenId: "tok-p1", player: 1 },
  ];
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ markets, refreshIntervalMs: 999_999_999 });
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => { emitted.push(e.data); });

  // p2 serves, p1 receives at AD, p2 at 30 → break point for p1 (the mapped token)
  (adapter as any).processMatch(markets[0], {
    id: 42,
    status: "live",
    players: { p1: { name: "Sinner" }, p2: { name: "Alcaraz" } },
    score: { server: 2, points: ["AD", "30"] },
  });

  expect(emitted).toHaveLength(1);
  const sig = emitted[0] as Signal<LiveTennisTradePayload>;
  expect(sig.kind).toBe("trade");
  expect(sig.tokenId).toBe("tok-p1");
  expect(sig.payload.side).toBe("BUY");
  expect(sig.payload.breakPointFor).toBe("p1");
  expect(sig.confidence).toBeGreaterThan(0);
});

test("processMatch emits SELL when the opponent holds break point against the mapped player", async () => {
  const markets: LiveTennisMarketMapping[] = [
    { matchId: 7, tokenId: "tok-p1", player: 1 },
  ];
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ markets });
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => { emitted.push(e.data); });

  // p1 serves, p2 receives at 40, p1 at 15 → break point for p2; token maps p1 → SELL
  (adapter as any).processMatch(markets[0], {
    id: 7,
    status: "live",
    players: { p1: { name: "A" }, p2: { name: "B" } },
    score: { server: 1, points: ["15", "40"] },
  });

  expect(emitted).toHaveLength(1);
  expect((emitted[0] as Signal<LiveTennisTradePayload>).payload.side).toBe("SELL");
});

test("processMatch de-duplicates a sustained break point (emits once)", async () => {
  const markets: LiveTennisMarketMapping[] = [
    { matchId: 1, tokenId: "tok", player: 2 },
  ];
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ markets });
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => { emitted.push(e.data); });

  const match = {
    id: 1,
    status: "live",
    players: { p1: { name: "A" }, p2: { name: "B" } },
    score: { server: 1, points: ["30", "40"] }, // break point for p2
  };
  (adapter as any).processMatch(markets[0], match);
  (adapter as any).processMatch(markets[0], match); // same state → no second emit

  expect(emitted).toHaveLength(1);
});

test("processMatch emits a one-shot risk signal on a terminal status", async () => {
  const markets: LiveTennisMarketMapping[] = [
    { matchId: 99, tokenId: "tok", player: 1 },
  ];
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ markets });
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => { emitted.push(e.data); });

  const retired = {
    id: 99,
    status: "retired",
    players: { p1: { name: "A" }, p2: { name: "B" } },
    score: {},
  };
  (adapter as any).processMatch(markets[0], retired);
  (adapter as any).processMatch(markets[0], retired); // dedup

  expect(emitted).toHaveLength(1);
  const sig = emitted[0] as Signal<LiveTennisRiskPayload>;
  expect(sig.kind).toBe("risk");
  expect(sig.tokenId).toBe("tok");
  expect(sig.payload.status).toBe("retired");
});

test("processMatch ignores upcoming (not-yet-live) matches", async () => {
  const markets: LiveTennisMarketMapping[] = [
    { matchId: 5, tokenId: "tok", player: 1 },
  ];
  const adapter = new LiveTennisAdapter();
  const ctx = makeCtx({ markets });
  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => { emitted.push(e.data); });

  (adapter as any).processMatch(markets[0], {
    id: 5,
    status: "upcoming",
    players: { p1: { name: "A" }, p2: { name: "B" } },
    score: { server: 1, points: ["40", "0"] },
  });

  expect(emitted).toHaveLength(0);
});
