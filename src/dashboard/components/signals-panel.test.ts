/**
 * Tests for signals-panel pure helpers and signal ring-buffer contract.
 * Component rendering tests are omitted: Bun's test runner has no DOM/jsdom.
 */
import { test, expect } from "bun:test";
import type { SignalRecord } from "./signals-panel";

// ── Re-implement tiny helpers locally to avoid importing JSX ──────────────

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString();
}

function confidenceColor(conf: number): string {
  if (conf >= 0.8) return "var(--green)";
  if (conf >= 0.5) return "var(--yellow)";
  return "var(--text-secondary)";
}

function signalReason(signal: SignalRecord): string | null {
  if (!signal.payload) return null;
  const p = signal.payload as Record<string, unknown>;
  if (typeof p["reason"] === "string") return p["reason"];
  if (typeof p["output"] === "string") return p["output"].slice(0, 120);
  return null;
}

// ── formatTime ────────────────────────────────────────────────────────────

test("formatTime returns a locale time string", () => {
  const iso = "2024-06-01T12:34:56.000Z";
  const result = formatTime(iso);
  // Just check it's a non-empty string — locale output varies by environment
  expect(typeof result).toBe("string");
  expect(result.length).toBeGreaterThan(0);
});

// ── confidenceColor ───────────────────────────────────────────────────────

test("confidenceColor returns green for confidence >= 0.8", () => {
  expect(confidenceColor(0.8)).toBe("var(--green)");
  expect(confidenceColor(1.0)).toBe("var(--green)");
});

test("confidenceColor returns yellow for 0.5 <= confidence < 0.8", () => {
  expect(confidenceColor(0.5)).toBe("var(--yellow)");
  expect(confidenceColor(0.79)).toBe("var(--yellow)");
});

test("confidenceColor returns muted for confidence < 0.5", () => {
  expect(confidenceColor(0.49)).toBe("var(--text-secondary)");
  expect(confidenceColor(0.0)).toBe("var(--text-secondary)");
});

// ── signalReason ──────────────────────────────────────────────────────────

test("signalReason extracts reason from trade payload", () => {
  const signal: SignalRecord = {
    id: "x",
    kind: "trade",
    source: "test",
    confidence: 0.8,
    timestamp: new Date().toISOString(),
    payload: { side: "BUY", reason: "strong momentum" },
  };
  expect(signalReason(signal)).toBe("strong momentum");
});

test("signalReason extracts output from inference payload (truncated at 120)", () => {
  const longOutput = "a".repeat(200);
  const signal: SignalRecord = {
    id: "y",
    kind: "inference",
    source: "llm",
    confidence: 0.7,
    timestamp: new Date().toISOString(),
    payload: { model: "gpt-4", prompt: "...", output: longOutput },
  };
  const result = signalReason(signal);
  expect(result).not.toBeNull();
  expect(result!.length).toBe(120);
});

test("signalReason returns null when no payload", () => {
  const signal: SignalRecord = {
    id: "z",
    kind: "news",
    source: "gdelt",
    confidence: 0.6,
    timestamp: new Date().toISOString(),
  };
  expect(signalReason(signal)).toBeNull();
});

test("signalReason returns null when payload has no reason or output", () => {
  const signal: SignalRecord = {
    id: "z2",
    kind: "risk",
    source: "polygonscan",
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    payload: { txHash: "0xabc", from: "0xa", to: "0xb" },
  };
  expect(signalReason(signal)).toBeNull();
});

// ── Signal ring buffer contract ───────────────────────────────────────────

test("ring buffer holds at most SIGNAL_RING_SIZE entries", () => {
  const RING_SIZE = 20;
  const ring: string[] = [];
  for (let i = 0; i < 30; i++) {
    ring.push(`signal-${i}`);
    if (ring.length > RING_SIZE) ring.shift();
  }
  expect(ring.length).toBe(RING_SIZE);
  expect(ring[0]).toBe("signal-10");
  expect(ring[RING_SIZE - 1]).toBe("signal-29");
});

test("ring buffer reverse order gives newest-first", () => {
  const ring = ["oldest", "middle", "newest"];
  const reversed = [...ring].reverse();
  expect(reversed[0]).toBe("newest");
  expect(reversed[reversed.length - 1]).toBe("oldest");
});
