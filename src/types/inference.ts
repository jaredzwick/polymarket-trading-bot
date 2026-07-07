/**
 * Supported LLM provider identifiers.
 * Phase 2 will map these to concrete client implementations.
 */
export type LLMProvider = "openai" | "anthropic" | "google" | "local";

/**
 * Configuration for the LLMDistillerAdapter — the built-in signal adapter
 * that queries an LLM on a schedule and distills its output into Signal objects.
 *
 * This config is passed as `AdapterContext.config` when the adapter is
 * registered. The adapter validates and casts it inside initialize().
 */
export interface LLMDistillerConfig {
  /** Which LLM provider to call. */
  provider: LLMProvider;
  /**
   * Provider-specific model identifier.
   * Examples: "gpt-4o", "claude-sonnet-4-6", "gemini-2.0-flash"
   */
  model: string;
  /**
   * API key. Prefer leaving this unset and injecting via env var
   * (OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.).
   */
  apiKey?: string;
  /** Override the provider base URL — useful for local/VLLM deployments. */
  baseUrl?: string;
  /**
   * Prompt template sent to the LLM each refresh cycle.
   * Supports these placeholders (substituted by the adapter before sending):
   *   {{marketSummary}}  — JSON summary of subscribed markets
   *   {{orderBookSlice}} — Top-of-book snapshot for each subscribed token
   *   {{timestamp}}      — ISO-8601 current time
   */
  promptTemplate: string;
  /**
   * JSON Schema string that the LLM response must conform to.
   * The adapter validates the parsed output against this schema.
   * Phase 2 ships with a default schema for InferenceSignalPayload.
   */
  outputSchema: string;
  /** Maximum tokens the LLM may produce. */
  maxTokens: number;
  /** Sampling temperature in [0, 1]. Use 0 for deterministic output. */
  temperature: number;
  /** How often to query the LLM (milliseconds). */
  refreshIntervalMs: number;
  /**
   * Minimum confidence threshold [0, 1].
   * Signals with parsed confidence below this value are silently dropped.
   */
  minConfidence: number;
  /** Optional: cap outbound requests at this rate (requests per minute). */
  rateLimitRpm?: number;
  /** Per-request timeout in milliseconds. Defaults to 30 000 in Phase 2. */
  timeoutMs?: number;
  /**
   * Token IDs to include in every prompt snapshot.
   * If empty, the adapter includes all tokens the MarketDataService tracks.
   */
  subscribedTokenIds?: string[];
}

/**
 * Expected structure when the LLM response is parsed into a signal.
 * Phase 2 ships a JSON Schema for this shape; consumers should not
 * trust raw LLM output — always validate before acting.
 */
export interface LLMDistillerOutput {
  tokenId: string;
  confidence: number;  // 0-1
  rationale: string;
  suggestedSide?: "BUY" | "SELL" | "HOLD";
  suggestedSize?: number;
}
