/**
 * Canonical signal kinds emitted by adapters onto the signal bus.
 * Phase 2 will register these as EventBus event types.
 */
export type SignalKind =
  | "trade"       // Directional trade recommendation
  | "news"        // External news or information event
  | "sentiment"   // Aggregated market sentiment score
  | "inference"   // LLM distiller output
  | "risk"        // Risk-level warning for a token or condition
  | "custom";     // Adapter-specific extension point

/**
 * A structured signal emitted by a SignalAdapter onto the signal bus.
 * Strategies subscribe to "signal_emitted" events and receive Signal objects.
 *
 * @template TPayload - Adapter-specific typed payload.
 */
export interface Signal<TPayload = unknown> {
  /** Unique signal identifier. Adapters should use crypto.randomUUID(). */
  id: string;
  kind: SignalKind;
  /** Name of the adapter that produced this signal. */
  source: string;
  /** Token ID this signal concerns, if applicable. */
  tokenId?: string;
  /** Condition/market ID this signal concerns, if applicable. */
  conditionId?: string;
  /**
   * Normalized confidence in [0, 1].
   * Strategies should gate on this before acting.
   */
  confidence: number;
  /** Adapter-specific payload — type-narrowed by consumers based on `kind`. */
  payload: TPayload;
  timestamp: Date;
  /** When set, consumers MUST discard this signal after this time. */
  expiresAt?: Date;
  /** Arbitrary key/value annotations. Do not put trading-critical data here. */
  metadata?: Record<string, unknown>;
}

/** Well-known payload type for "trade" signals. */
export interface TradeSignalPayload {
  side: "BUY" | "SELL";
  targetPrice: number;
  size: number;
  reason: string;
}

/** Well-known payload type for "sentiment" signals. */
export interface SentimentSignalPayload {
  score: number;     // -1 (bearish) to +1 (bullish)
  sources: string[]; // e.g. ["twitter", "reddit"]
}

/** Well-known payload type for "inference" signals. */
export interface InferenceSignalPayload {
  model: string;
  prompt: string;
  output: string;
  parsedConfidence?: number;
  rawTokens?: number;
}
