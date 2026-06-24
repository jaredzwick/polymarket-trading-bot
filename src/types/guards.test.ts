import { test, expect, describe } from "bun:test";
import {
  isSignalKind,
  isSignal,
  isLLMProvider,
  isLLMDistillerConfig,
  isSignalAdapter,
  isAdapterContext,
  isSignalOfKind,
  isSignalFresh,
} from "./guards";
import type { Signal } from "./signal";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: "test-id-1",
    kind: "trade",
    source: "test-adapter",
    confidence: 0.8,
    payload: { side: "BUY", targetPrice: 0.65, size: 10, reason: "test" },
    timestamp: new Date("2026-01-01T00:00:00Z"),
    ...overrides,
  };
}

function makeAdapter() {
  return {
    name: "test-adapter",
    version: "1.0.0",
    initialize: async () => {},
    start: async () => {},
    shutdown: async () => {},
  };
}

function makeDistillerConfig() {
  return {
    provider: "anthropic" as const,
    model: "claude-sonnet-4-6",
    promptTemplate: "Analyze {{marketSummary}}",
    outputSchema: '{"type":"object"}',
    maxTokens: 512,
    temperature: 0.2,
    refreshIntervalMs: 60_000,
    minConfidence: 0.5,
  };
}

// ── isSignalKind ──────────────────────────────────────────────────────────────

describe("isSignalKind", () => {
  test("accepts all valid kinds", () => {
    for (const k of ["trade", "news", "sentiment", "inference", "risk", "custom"] as const) {
      expect(isSignalKind(k)).toBe(true);
    }
  });

  test("rejects unknown strings", () => {
    expect(isSignalKind("arbitrage")).toBe(false);
    expect(isSignalKind("TRADE")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isSignalKind(42)).toBe(false);
    expect(isSignalKind(null)).toBe(false);
    expect(isSignalKind(undefined)).toBe(false);
    expect(isSignalKind({})).toBe(false);
  });
});

// ── isSignal ──────────────────────────────────────────────────────────────────

describe("isSignal", () => {
  test("accepts a valid signal", () => {
    expect(isSignal(makeSignal())).toBe(true);
  });

  test("accepts signal with optional fields set", () => {
    const s = makeSignal({
      tokenId: "0xabc",
      conditionId: "0xdef",
      expiresAt: new Date(Date.now() + 60_000),
      metadata: { source: "unit-test" },
    });
    expect(isSignal(s)).toBe(true);
  });

  test("rejects missing id", () => {
    const { id: _id, ...rest } = makeSignal();
    expect(isSignal(rest)).toBe(false);
  });

  test("rejects empty id", () => {
    expect(isSignal(makeSignal({ id: "" }))).toBe(false);
  });

  test("rejects invalid kind", () => {
    expect(isSignal(makeSignal({ kind: "unknown" as never }))).toBe(false);
  });

  test("rejects confidence out of range", () => {
    expect(isSignal(makeSignal({ confidence: 1.1 }))).toBe(false);
    expect(isSignal(makeSignal({ confidence: -0.1 }))).toBe(false);
  });

  test("rejects non-Date timestamp", () => {
    expect(isSignal(makeSignal({ timestamp: "2026-01-01" as never }))).toBe(false);
  });

  test("rejects null and primitives", () => {
    expect(isSignal(null)).toBe(false);
    expect(isSignal(42)).toBe(false);
    expect(isSignal("signal")).toBe(false);
    expect(isSignal([])).toBe(false);
  });

  test("rejects non-object metadata", () => {
    expect(isSignal(makeSignal({ metadata: "bad" as never }))).toBe(false);
  });
});

// ── isLLMProvider ─────────────────────────────────────────────────────────────

describe("isLLMProvider", () => {
  test("accepts all valid providers", () => {
    for (const p of ["openai", "anthropic", "google", "local"] as const) {
      expect(isLLMProvider(p)).toBe(true);
    }
  });

  test("rejects unknown providers", () => {
    expect(isLLMProvider("cohere")).toBe(false);
    expect(isLLMProvider("OpenAI")).toBe(false);
  });

  test("rejects non-strings", () => {
    expect(isLLMProvider(null)).toBe(false);
    expect(isLLMProvider(undefined)).toBe(false);
    expect(isLLMProvider(1)).toBe(false);
  });
});

// ── isLLMDistillerConfig ──────────────────────────────────────────────────────

describe("isLLMDistillerConfig", () => {
  test("accepts a minimal valid config", () => {
    expect(isLLMDistillerConfig(makeDistillerConfig())).toBe(true);
  });

  test("accepts config with optional fields", () => {
    const c = {
      ...makeDistillerConfig(),
      apiKey: "sk-test",
      baseUrl: "http://localhost:11434",
      rateLimitRpm: 60,
      timeoutMs: 10_000,
      subscribedTokenIds: ["0xabc"],
    };
    expect(isLLMDistillerConfig(c)).toBe(true);
  });

  test("rejects invalid provider", () => {
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), provider: "cohere" })).toBe(false);
  });

  test("rejects zero or negative maxTokens", () => {
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), maxTokens: 0 })).toBe(false);
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), maxTokens: -1 })).toBe(false);
  });

  test("rejects temperature out of range", () => {
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), temperature: 1.1 })).toBe(false);
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), temperature: -0.1 })).toBe(false);
  });

  test("rejects minConfidence out of range", () => {
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), minConfidence: 1.5 })).toBe(false);
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), minConfidence: -0.1 })).toBe(false);
  });

  test("rejects zero refreshIntervalMs", () => {
    expect(isLLMDistillerConfig({ ...makeDistillerConfig(), refreshIntervalMs: 0 })).toBe(false);
  });

  test("rejects null", () => {
    expect(isLLMDistillerConfig(null)).toBe(false);
    expect(isLLMDistillerConfig("config")).toBe(false);
  });
});

// ── isSignalAdapter ───────────────────────────────────────────────────────────

describe("isSignalAdapter", () => {
  test("accepts a valid adapter object", () => {
    expect(isSignalAdapter(makeAdapter())).toBe(true);
  });

  test("rejects missing methods", () => {
    const { initialize: _i, ...noInit } = makeAdapter();
    expect(isSignalAdapter(noInit)).toBe(false);

    const { start: _s, ...noStart } = makeAdapter();
    expect(isSignalAdapter(noStart)).toBe(false);

    const { shutdown: _sh, ...noShutdown } = makeAdapter();
    expect(isSignalAdapter(noShutdown)).toBe(false);
  });

  test("rejects empty name", () => {
    expect(isSignalAdapter({ ...makeAdapter(), name: "" })).toBe(false);
  });

  test("rejects non-function methods", () => {
    expect(isSignalAdapter({ ...makeAdapter(), initialize: "noop" })).toBe(false);
  });

  test("rejects null", () => {
    expect(isSignalAdapter(null)).toBe(false);
    expect(isSignalAdapter(42)).toBe(false);
  });
});

// ── isAdapterContext ──────────────────────────────────────────────────────────

describe("isAdapterContext", () => {
  test("accepts a valid context shape", () => {
    const ctx = {
      marketData: {},
      events: {},
      logger: {},
      config: {},
    };
    expect(isAdapterContext(ctx)).toBe(true);
  });

  test("rejects missing fields", () => {
    expect(isAdapterContext({ events: {}, logger: {}, config: {} })).toBe(false);
    expect(isAdapterContext({ marketData: {}, logger: {}, config: {} })).toBe(false);
  });

  test("rejects null fields", () => {
    expect(isAdapterContext({ marketData: null, events: {}, logger: {}, config: {} })).toBe(false);
  });
});

// ── isSignalOfKind ────────────────────────────────────────────────────────────

describe("isSignalOfKind", () => {
  test("narrows to the correct kind", () => {
    const s = makeSignal({ kind: "inference" });
    expect(isSignalOfKind(s, "inference")).toBe(true);
    expect(isSignalOfKind(s, "trade")).toBe(false);
  });
});

// ── isSignalFresh ─────────────────────────────────────────────────────────────

describe("isSignalFresh", () => {
  test("returns true when no expiresAt is set", () => {
    expect(isSignalFresh(makeSignal())).toBe(true);
  });

  test("returns true when expiresAt is in the future", () => {
    const future = new Date(Date.now() + 10_000);
    expect(isSignalFresh(makeSignal({ expiresAt: future }))).toBe(true);
  });

  test("returns false when expiresAt is in the past", () => {
    const past = new Date(Date.now() - 1);
    expect(isSignalFresh(makeSignal({ expiresAt: past }))).toBe(false);
  });

  test("accepts a custom atTime reference point", () => {
    const expiry = new Date("2026-06-01T00:00:00Z");
    const before = new Date("2026-05-31T23:59:59Z");
    const after = new Date("2026-06-01T00:00:01Z");
    const s = makeSignal({ expiresAt: expiry });
    expect(isSignalFresh(s, before)).toBe(true);
    expect(isSignalFresh(s, after)).toBe(false);
  });
});
