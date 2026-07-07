import type { Signal, SignalKind } from "./signal";
import type { SignalAdapter, AdapterContext } from "./adapter";
import type { LLMDistillerConfig, LLMProvider } from "./inference";

const SIGNAL_KINDS = new Set<SignalKind>(["trade", "news", "sentiment", "inference", "risk", "custom"]);
const LLM_PROVIDERS = new Set<LLMProvider>(["openai", "anthropic", "google", "local"]);

export function isSignalKind(value: unknown): value is SignalKind {
  return typeof value === "string" && SIGNAL_KINDS.has(value as SignalKind);
}

export function isSignal(value: unknown): value is Signal {
  if (typeof value !== "object" || value === null) return false;
  const s = value as Record<string, unknown>;
  return (
    typeof s.id === "string" &&
    s.id.length > 0 &&
    isSignalKind(s.kind) &&
    typeof s.source === "string" &&
    s.source.length > 0 &&
    typeof s.confidence === "number" &&
    s.confidence >= 0 &&
    s.confidence <= 1 &&
    s.timestamp instanceof Date &&
    (s.tokenId === undefined || typeof s.tokenId === "string") &&
    (s.conditionId === undefined || typeof s.conditionId === "string") &&
    (s.expiresAt === undefined || s.expiresAt instanceof Date) &&
    (s.metadata === undefined || (typeof s.metadata === "object" && s.metadata !== null))
  );
}

export function isLLMProvider(value: unknown): value is LLMProvider {
  return typeof value === "string" && LLM_PROVIDERS.has(value as LLMProvider);
}

export function isLLMDistillerConfig(value: unknown): value is LLMDistillerConfig {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    isLLMProvider(c.provider) &&
    typeof c.model === "string" &&
    c.model.length > 0 &&
    typeof c.promptTemplate === "string" &&
    typeof c.outputSchema === "string" &&
    typeof c.maxTokens === "number" &&
    c.maxTokens > 0 &&
    typeof c.temperature === "number" &&
    c.temperature >= 0 &&
    c.temperature <= 1 &&
    typeof c.refreshIntervalMs === "number" &&
    c.refreshIntervalMs > 0 &&
    typeof c.minConfidence === "number" &&
    c.minConfidence >= 0 &&
    c.minConfidence <= 1 &&
    (c.apiKey === undefined || typeof c.apiKey === "string") &&
    (c.baseUrl === undefined || typeof c.baseUrl === "string") &&
    (c.rateLimitRpm === undefined || (typeof c.rateLimitRpm === "number" && c.rateLimitRpm > 0)) &&
    (c.timeoutMs === undefined || (typeof c.timeoutMs === "number" && c.timeoutMs > 0))
  );
}

export function isSignalAdapter(value: unknown): value is SignalAdapter {
  if (typeof value !== "object" || value === null) return false;
  const a = value as Record<string, unknown>;
  return (
    typeof a.name === "string" &&
    a.name.length > 0 &&
    typeof a.version === "string" &&
    a.version.length > 0 &&
    typeof a.initialize === "function" &&
    typeof a.start === "function" &&
    typeof a.shutdown === "function"
  );
}

export function isAdapterContext(value: unknown): value is AdapterContext {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c.marketData === "object" && c.marketData !== null &&
    typeof c.events === "object" && c.events !== null &&
    typeof c.logger === "object" && c.logger !== null &&
    typeof c.config === "object" && c.config !== null
  );
}

/** Narrows a Signal to only those of a specific kind. */
export function isSignalOfKind<K extends SignalKind>(
  signal: Signal,
  kind: K
): signal is Signal & { kind: K } {
  return signal.kind === kind;
}

/** Returns true if the signal has not expired at the given time (defaults to now). */
export function isSignalFresh(signal: Signal, atTime: Date = new Date()): boolean {
  if (!signal.expiresAt) return true;
  return signal.expiresAt.getTime() > atTime.getTime();
}
