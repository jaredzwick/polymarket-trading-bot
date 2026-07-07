# LLM Distiller Config

The `LLMDistillerConfig` type configures the built-in `LLMDistillerAdapter`,
which is the primary inference-based signal source in the pluggable framework.
It queries an LLM on a fixed schedule, validates the response, and emits
`Signal<InferenceSignalPayload>` objects onto the bus.

## Type

```typescript
interface LLMDistillerConfig {
  provider: LLMProvider;      // "openai" | "anthropic" | "google" | "local"
  model: string;              // Provider-specific model ID
  apiKey?: string;            // Prefer env-var injection; do NOT commit keys
  baseUrl?: string;           // Override for local / VLLM deployments
  promptTemplate: string;     // Template with {{marketSummary}}, {{orderBookSlice}}, {{timestamp}}
  outputSchema: string;       // JSON Schema that the LLM response must match
  maxTokens: number;          // Upper bound on response tokens
  temperature: number;        // 0–1 sampling temperature
  refreshIntervalMs: number;  // How often to poll the LLM (ms)
  minConfidence: number;      // Signals below this threshold are dropped (0–1)
  rateLimitRpm?: number;      // Optional requests-per-minute cap
  timeoutMs?: number;         // Per-request timeout (ms); default 30 000
  subscribedTokenIds?: string[]; // Tokens to include in every prompt; empty = all tracked
}
```

## Supported Providers

| Provider    | Env var            | Notes                                 |
|-------------|--------------------|---------------------------------------|
| `openai`    | `OPENAI_API_KEY`   | Uses `/v1/chat/completions`           |
| `anthropic` | `ANTHROPIC_API_KEY`| Uses Messages API with tool_use       |
| `google`    | `GOOGLE_API_KEY`   | Uses Gemini generateContent           |
| `local`     | —                  | Requires `baseUrl`; OpenAI-compatible |

## Prompt Template Placeholders

| Placeholder          | Substituted value                                                |
|----------------------|------------------------------------------------------------------|
| `{{marketSummary}}`  | JSON array of `{ conditionId, question, tokens[] }` for tracked markets |
| `{{orderBookSlice}}` | JSON array of `{ tokenId, midPrice, spread, topBid, topAsk }`   |
| `{{timestamp}}`      | ISO-8601 UTC string of the query time                            |

## Expected LLM Output Schema

The default `outputSchema` expects an array of `LLMDistillerOutput` objects:

```json
{
  "type": "array",
  "items": {
    "type": "object",
    "required": ["tokenId", "confidence", "rationale"],
    "properties": {
      "tokenId":       { "type": "string" },
      "confidence":    { "type": "number", "minimum": 0, "maximum": 1 },
      "rationale":     { "type": "string" },
      "suggestedSide": { "type": "string", "enum": ["BUY", "SELL", "HOLD"] },
      "suggestedSize": { "type": "number", "minimum": 0 }
    }
  }
}
```

Customize `outputSchema` to extend this for domain-specific adapters.

## Validation

`isLLMDistillerConfig(value)` validates any unknown value against the full
config contract, including range checks on `temperature`, `minConfidence`,
`maxTokens`, and `refreshIntervalMs`.

## Security Notes

- Never set `apiKey` in source code. Use environment variables.
- The `promptTemplate` is user-controlled — never interpolate user-supplied
  market data without sanitization (no injection surface for on-chain data,
  but be cautious with `question` fields from external APIs).
- Phase 2 will sandbox the LLM output parser; until then, treat parsed output
  as untrusted and validate before acting.

## Example Config

```typescript
const distillerConfig: LLMDistillerConfig = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  promptTemplate: `
You are a Polymarket analyst. Given the following order book data:
{{orderBookSlice}}

Return a JSON array of signals per token (see schema). Be conservative —
only flag clear mispricings you are confident about.`,
  outputSchema: DEFAULT_OUTPUT_SCHEMA,  // shipped in Phase 2
  maxTokens: 512,
  temperature: 0.1,
  refreshIntervalMs: 60_000,
  minConfidence: 0.65,
  rateLimitRpm: 10,
  timeoutMs: 15_000,
};
```
