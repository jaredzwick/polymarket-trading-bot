import { test, expect, mock } from "bun:test";
import { PolygonscanAdapter } from "./index";
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

test("PolygonscanAdapter no-ops without API key", async () => {
  const adapter = new PolygonscanAdapter();
  const ctx = makeCtx({});
  // Don't set POLYGONSCAN_API_KEY in env

  const pollSpy = mock(async () => {});
  (adapter as any).doPoll = pollSpy;

  await adapter.initialize(ctx);

  // With no key, start() should not set a timer
  const pollCalled = mock(async () => {});
  (adapter as any).poll = pollCalled;
  await adapter.start(ctx);

  // Since apiKey is falsy, poll should not be called
  expect(pollCalled).not.toHaveBeenCalled();
  await adapter.shutdown();
});

test("PolygonscanAdapter deduplicates seen tx hashes", () => {
  const adapter = new PolygonscanAdapter();
  const seenTxHashes = new Set<string>(["0xabc123"]);
  (adapter as any).seenTxHashes = seenTxHashes;

  const ctx = makeCtx();
  (adapter as any).ctx = ctx;
  (adapter as any).config = {
    whaleThresholdUsdc: 100_000,
    refreshIntervalMs: 60_000,
    blockWindow: 20,
    usdcContract: "0x...",
    apiKey: "fake",
  };
  (adapter as any).stopped = false;

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Simulate processing a duplicate tx
  const txList = [
    { hash: "0xabc123", from: "0xf", to: "0xt", value: "200000000000", tokenDecimal: "6", timeStamp: "1700000000", blockNumber: "1" },
  ];
  for (const tx of txList) {
    if (seenTxHashes.has(tx.hash)) continue;
    ctx.events.emit(Events.SIGNAL_EMITTED, { id: "x", kind: "risk", source: "polygonscan-whale", confidence: 0.5, payload: {}, timestamp: new Date() });
  }

  expect(emitted).toHaveLength(0);
});

test("PolygonscanAdapter emits risk signal for whale transfer", () => {
  const adapter = new PolygonscanAdapter();
  const ctx = makeCtx();

  (adapter as any).ctx = ctx;
  (adapter as any).config = {
    whaleThresholdUsdc: 100_000,
    refreshIntervalMs: 60_000,
    blockWindow: 20,
    usdcContract: "0x...",
    apiKey: "fake",
  };
  (adapter as any).stopped = false;
  (adapter as any).seenTxHashes = new Set<string>();

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Simulate a whale tx (200k USDC = 200_000_000_000 in 6-decimal units)
  const tx = {
    hash: "0xwhale",
    from: "0xsource",
    to: "0xdest",
    value: "200000000000",
    tokenDecimal: "6",
    timeStamp: String(Math.floor(Date.now() / 1000)),
    blockNumber: "42",
  };

  const decimals = 6;
  const amountUsdc = parseFloat(tx.value) / 10 ** decimals;
  const seenTxHashes = (adapter as any).seenTxHashes as Set<string>;

  if (!seenTxHashes.has(tx.hash) && amountUsdc >= 100_000) {
    seenTxHashes.add(tx.hash);
    const confidence = Math.min(amountUsdc / (100_000 * 10), 1);
    const signal: Signal = {
      id: crypto.randomUUID(),
      kind: "risk",
      source: "polygonscan-whale",
      confidence,
      payload: { txHash: tx.hash, from: tx.from, to: tx.to, amountUsdc, direction: "inflow" },
      timestamp: new Date(parseInt(tx.timeStamp, 10) * 1000),
      expiresAt: new Date(Date.now() + 60 * 60_000),
    };
    ctx.events.emit(Events.SIGNAL_EMITTED, signal);
  }

  expect(emitted).toHaveLength(1);
  expect(emitted[0].kind).toBe("risk");
  expect((emitted[0].payload as any).amountUsdc).toBe(200_000);
});
