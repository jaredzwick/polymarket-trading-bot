import { test, expect, mock } from "bun:test";
import { LLMDistillerAdapter } from "./index";
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

test("LLMDistillerAdapter no-ops without API key", async () => {
  const adapter = new LLMDistillerAdapter();
  const ctx = makeCtx({ provider: "anthropic", model: "claude-haiku-4-5-20251001" });

  const queryCalled = mock(async () => {});
  (adapter as any).query = queryCalled;

  await adapter.initialize(ctx);
  await adapter.start(ctx); // Should not call query because no API key
  expect(queryCalled).not.toHaveBeenCalled();
  await adapter.shutdown();
});

test("LLMDistillerAdapter emits inference signal from valid response", async () => {
  const adapter = new LLMDistillerAdapter();
  const ctx = makeCtx({
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptTemplate: "test {{marketSummary}} {{orderBookSlice}} {{timestamp}}",
    outputSchema: "{}",
    maxTokens: 100,
    temperature: 0,
    refreshIntervalMs: 999_999_999,
    minConfidence: 0.5,
  });

  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;

  // Inject a fake API key so the guard passes
  (adapter as any).apiKey = "sk-fake";

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Mock the provider call to return valid JSON
  const fakeResponse = JSON.stringify({
    tokenId: "token-123",
    confidence: 0.8,
    rationale: "Strong buying pressure",
    suggestedSide: "BUY",
    suggestedSize: 15,
  });
  (adapter as any).callProvider = mock(async () => fakeResponse);

  await (adapter as any).query();

  expect(emitted).toHaveLength(1);
  expect(emitted[0].kind).toBe("inference");
  expect(emitted[0].tokenId).toBe("token-123");
  expect(emitted[0].confidence).toBe(0.8);
  expect((emitted[0].metadata as any).suggestedSide).toBe("BUY");
});

test("LLMDistillerAdapter drops signal below minConfidence", async () => {
  const adapter = new LLMDistillerAdapter();
  const ctx = makeCtx({
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptTemplate: "test {{marketSummary}} {{orderBookSlice}} {{timestamp}}",
    outputSchema: "{}",
    maxTokens: 100,
    temperature: 0,
    refreshIntervalMs: 999_999_999,
    minConfidence: 0.9,
  });

  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;
  (adapter as any).apiKey = "sk-fake";

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  const lowConfidenceResponse = JSON.stringify({
    tokenId: "token-456",
    confidence: 0.3, // below 0.9 threshold
    rationale: "Weak signal",
  });
  (adapter as any).callProvider = mock(async () => lowConfidenceResponse);

  await (adapter as any).query();

  expect(emitted).toHaveLength(0);
});

test("LLMDistillerAdapter handles malformed LLM response gracefully", async () => {
  const adapter = new LLMDistillerAdapter();
  const ctx = makeCtx({
    provider: "openai",
    model: "gpt-4o",
    promptTemplate: "test {{marketSummary}} {{orderBookSlice}} {{timestamp}}",
    outputSchema: "{}",
    maxTokens: 100,
    temperature: 0,
    refreshIntervalMs: 999_999_999,
    minConfidence: 0.5,
  });

  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;
  (adapter as any).apiKey = "sk-fake";

  const emitted: Signal[] = [];
  ctx.events.on<Signal>(Events.SIGNAL_EMITTED, (e) => emitted.push(e.data));

  // Return garbage — should not throw, should not emit
  (adapter as any).callProvider = mock(async () => "not json at all lol");

  await (adapter as any).query();

  expect(emitted).toHaveLength(0);
  expect(adapter.isHealthy()).toBe(true); // parse failure != unhealthy
});

test("LLMDistillerAdapter diagnostics reports request count", async () => {
  const adapter = new LLMDistillerAdapter();
  const ctx = makeCtx({
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    promptTemplate: "test {{marketSummary}} {{orderBookSlice}} {{timestamp}}",
    outputSchema: "{}",
    maxTokens: 100,
    temperature: 0,
    refreshIntervalMs: 999_999_999,
    minConfidence: 0.5,
  });

  await adapter.initialize(ctx);
  (adapter as any).ctx = ctx;
  (adapter as any).stopped = false;
  (adapter as any).apiKey = "sk-fake";
  (adapter as any).callProvider = mock(async () =>
    JSON.stringify({ tokenId: "t", confidence: 0.7, rationale: "test" })
  );

  await (adapter as any).query();

  const diag = adapter.diagnostics();
  expect(diag.requestCount).toBe(1);
  expect(diag.provider).toBe("anthropic");
});
